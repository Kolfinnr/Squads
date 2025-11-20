import { FLAG_SCOPE, DEFAULT_FLAGS, WEAPONS, ROLES, ROLL, SCALING } from "../config.js";
import { aggregateForAttack, aggregateForDefense, ensureDisorganized, findGuardOnTarget, consumeGuardLink, addEffect, ensureEffect } from "../logic/effects.js";
import { setCooldown, clearCooldown } from "../logic/cooldowns.js";
import { sendActionMessage } from "../services/chat.js";
import { maybeTriggerHoB } from "../logic/hob.js";
import {
  adjustAttackTN,
  adjustAttackDamage,
  adjustDefenseSoak,
  adjustIncomingDamage,
  adjustChipDamage,
  applyPostAttackEffects,
  recordDamageTaken,
  handleMoraleZero,
  adjustMoraleLoss,
  maybeTriggerAestheticHoB,
  getOrigin,
  getPassives
} from "../logic/origins.js";
import { isSpecialist, isEngineer } from "../logic/specialists.js";

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const clampTN = (tn) => Math.min(ROLL.maxTN, Math.max(ROLL.minTN, tn));

const getF = (actor, key, def) => actor.getFlag(FLAG_SCOPE, key) ?? foundry.utils.getProperty(DEFAULT_FLAGS, key) ?? def;

const RELOAD_COOLDOWN_KEY = "reload";

const escapeHTML = (value) => {
  if (typeof TextEditor?.escapeHTML === "function") {
    return TextEditor.escapeHTML(String(value ?? ""));
  }
  const utilEscape = foundry?.utils?.escapeHTML ?? foundry?.utils?.escapeHtml;
  if (typeof utilEscape === "function") {
    return utilEscape(String(value ?? ""));
  }
  return String(value ?? "");
};

function mergeHoBResults(primary, extra) {
  if (!extra) return primary;
  if (!primary) return extra;
  primary.notes = [...(primary.notes ?? []), ...(extra.notes ?? [])];
  primary.tnAdjustments = [...(primary.tnAdjustments ?? []), ...(extra.tnAdjustments ?? [])];
  primary.damageAdjustments = [...(primary.damageAdjustments ?? []), ...(extra.damageAdjustments ?? [])];
  primary.damageMultiplier = Number(primary.damageMultiplier || 1) * Number(extra.damageMultiplier || 1);
  return primary;
}

async function postStatusLine(actor, key) {
  if (!actor) return;
  const name = escapeHTML(actor.name || game.i18n.localize("W4SQ.UnknownSquad"));
  const template = game.i18n.has(key) ? game.i18n.format(key, { name }) : `<strong>${name}</strong>`;
  const content = `<p>${template}</p>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });
}

function baseReloadRounds(weaponKey) {
  switch (weaponKey) {
    case "bow":
    case "crossbow":
      return 1;
    case "firearm":
      return 2;
    case "artillery":
      return 3;
    default:
      return 0;
  }
}

async function applyReloadingCooldown(actor, action, weaponKey, tags = {}) {
  if (action !== "ranged") return;
  if (tags.continuousFire) {
    await clearCooldown(actor, RELOAD_COOLDOWN_KEY);
    return;
  }
  let rounds = baseReloadRounds(weaponKey);
  if (rounds <= 0) {
    await clearCooldown(actor, RELOAD_COOLDOWN_KEY);
    return;
  }
  if (tags.fastReload) {
    rounds = Math.max(1, rounds - 1);
  }
  await setCooldown(actor, RELOAD_COOLDOWN_KEY, rounds);
}

async function rollMaybe(expr) {
  const s = (expr || "").toString().trim();
  if (!s || s === "0") return { total: 0, formula: "0" };
  if (s === "-1/2") return { total: -0.5, formula: "-1/2" };
  const r = await (new Roll(s).evaluate({}));
  return { total: r.total, formula: r.formula };
}

function hpScale(cur, max) {
  const ratio = Math.max(0, Math.min(1, Number(max) ? Number(cur) / Number(max) : 0));
  return SCALING.hpFloor + (1 - SCALING.hpFloor) * ratio;
}

function applySpecialistTN(actor, tn, hp, hpMax) {
  if (!isSpecialist(actor)) return clampTN(tn);
  const safeMax = Math.max(0, Number(hpMax) || 0);
  const ratio = safeMax > 0 ? Math.max(0, Math.min(1, Number(hp) / safeMax)) : 0;
  const capped = Math.min(90, tn);
  const scaled = capped * ratio;
  return clampTN(Math.max(ROLL.minTN, Math.floor(scaled)));
}

function roleBonuses(role, action) {
  switch (role) {
    case "infantry":
    case "mounted":
      return action === "melee" ? { acc: "+1d10", dmg: "+1d10" } : { acc: "0", dmg: "0" };
    case "ranged":
      if (action === "ranged") return { acc: "+1d10", dmg: "+1d10" };
      if (action === "melee") return { acc: "-1d20", dmg: "-1d20" };
      return { acc: "0", dmg: "0" };
    case "specialist":
      return { acc: "0", dmg: "0" };
    default:
      return { acc: "0", dmg: "0" };
  }
}

async function moraleLossFor(defender, attacker, finalDamage, options = {}) {
  if (defender.getFlag(FLAG_SCOPE, "unbreakable")) return null;
  const base = finalDamage;
  const extraRoll = await (new Roll("1d20").evaluate({}));
  let total = base + extraRoll.total + Number(options.moraleBonus ?? 0);
  const extras = [];
  if (attacker.getFlag(FLAG_SCOPE, "fear")) {
    const fearRoll = await (new Roll("1d10").evaluate({}));
    total += fearRoll.total;
    extras.push(fearRoll.total);
  }
  if (attacker.getFlag(FLAG_SCOPE, "terror")) {
    const terrorRoll = await (new Roll("3d10").evaluate({}));
    total += terrorRoll.total;
    extras.push(terrorRoll.total);
  }
  const defenderTerror = defender.getFlag(FLAG_SCOPE, "terror");
  if (defenderTerror && attacker.getFlag(FLAG_SCOPE, "fear") && !attacker.getFlag(FLAG_SCOPE, "terror")) {
    const counter = await (new Roll("1d10").evaluate({}));
    total += counter.total;
    extras.push(counter.total);
  }
  const moraleMax = Number(defender.getFlag(FLAG_SCOPE, "moraleMax") || 0);
  const morale = Number(defender.getFlag(FLAG_SCOPE, "morale") || 0);
  total = await adjustMoraleLoss(defender, attacker, { total, baseDamage: finalDamage, bonus: options.moraleBonus ?? 0 });
  const next = clamp(morale - total, 0, moraleMax);
  await defender.setFlag(FLAG_SCOPE, "morale", next);
  if (morale > 0 && next <= 0) {
    await postStatusLine(defender, "W4SQ.ChatMoraleZero");
    if (getOrigin(defender) === "undead") {
      await ensureEffect(defender, {
        key: "crumbling",
        label: game.i18n.localize("W4SQ.EffectCrumbling"),
        duration: 99,
        mods: { tags: { crumbling: true } }
      }, effect => Boolean(effect?.mods?.tags?.crumbling));
    } else {
      await ensureEffect(defender, {
        key: "routed",
        label: game.i18n.localize("W4SQ.EffectRouted"),
        duration: 99,
        mods: { tags: { routed: true, disorganized: true } }
      }, effect => Boolean(effect?.mods?.tags?.routed));
    }
    await handleMoraleZero(defender, attacker);
  }
  if (moraleMax > 0 && next / moraleMax < 0.5) {
    await ensureDisorganized(defender, { source: "morale" });
  }
  return total;
}

async function applyDamage(actor, defender, finalDamage, options = {}) {
  const hpMax = Number(defender.getFlag(FLAG_SCOPE, "hpMax") || 0);
  const hp = Number(defender.getFlag(FLAG_SCOPE, "hp") || 0);
  const next = clamp(hp - finalDamage, 0, hpMax);
  await defender.setFlag(FLAG_SCOPE, "hp", next);
  if (hp > 0 && next <= 0) {
    await postStatusLine(defender, "W4SQ.ChatHPZero");
  }
  const applied = Math.max(0, hp - next);
  if (options.isMagical && applied > 0) {
    const name = escapeHTML(defender.name || game.i18n.localize("W4SQ.UnknownSquad"));
    const formatted = game.i18n.format("W4SQ.ChatMageSpellDamage", { target: name, amount: applied });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${formatted}</p>`
    });
  }
  const moraleLoss = await moraleLossFor(defender, actor, finalDamage, options);
  await actor.setFlag(FLAG_SCOPE, "lastTargetName", defender.name || "");
  return { moraleLoss, hpDamage: applied };
}

function selectedTarget() {
  const targets = [...game.user.targets];
  if (targets.length !== 1) return null;
  return targets[0].actor;
}

export async function doSquadAction(actor, action) {
  const exp = Number(getF(actor, "experienceTier", 0));
  const eq = Number(getF(actor, "equipmentTier", 0));
  const role = getF(actor, "role", "infantry");
  const weaponKey = role === "specialist" ? null : getF(actor, "weapon", "sword");
  const weapon = weaponKey ? (WEAPONS[weaponKey] ?? WEAPONS.sword) : { accuracyDice: "0", dmgDice: "0", pierceArmor: false };
  const roleDef = ROLES[role] ?? ROLES.infantry;

  const backlineAttack = Boolean(getF(actor, "backlineAttack", false));
  const weaponLabel = weaponKey ?? "—";
  const aggAttack = aggregateForAttack(actor, { action, weapon: weaponKey });
  const attackerOrigin = getOrigin(actor);
  const attackerPassives = getPassives(actor);
  const roleBonus = roleBonuses(role, action);

  const weaponAcc = await rollMaybe(weapon.accuracyDice);
  const roleAcc = await rollMaybe(roleBonus.acc);
  const effAcc = await rollMaybe(aggAttack.tnDice);
  const hybridPenalty = roleDef.hybridPenalty && (action === "melee" || action === "ranged")
    ? (await rollMaybe("-1d10")).total
    : 0;

  let tn = ROLL.baseTN + exp * 7 + eq * 5 + weaponAcc.total + roleAcc.total + effAcc.total + hybridPenalty;
  const morale = Number(getF(actor, "morale", 0));
  const moraleMax = Number(getF(actor, "moraleMax", 1));
  const hp = Number(getF(actor, "hp", 0));
  const hpMax = Number(getF(actor, "hpMax", 1));
  if (moraleMax > 0 && morale / moraleMax < 0.3) tn -= 10;
  if (hp <= 0) tn -= 20;

  let targetActor = selectedTarget();
  let guardContext = null;
  let effectiveBackline = backlineAttack;
  if (targetActor && action === "melee") {
    const guardInfo = findGuardOnTarget(targetActor);
    if (guardInfo?.guardActor && guardInfo.guardActor !== targetActor) {
      guardContext = { ...guardInfo, protectedActor: targetActor };
      await consumeGuardLink({
        guardActor: guardInfo.guardActor,
        targetActor,
        guardEffect: guardInfo.guardEffect,
        targetEffect: guardInfo.targetEffect
      });
      targetActor = guardInfo.guardActor;
    }
  }
  effectiveBackline = backlineAttack && !guardContext;
  tn = await adjustAttackTN(actor, targetActor, { tn, action, isCharge: Boolean(aggAttack.tags?.charged) });
  const roll = await (new Roll("1d100").evaluate({}));
  let success = roll.total <= applySpecialistTN(actor, tn, hp, hpMax);
  let hobResult = await maybeTriggerHoB(actor, { roll: roll.total, success, type: action, target: targetActor });
  const aestheticHoB = await maybeTriggerAestheticHoB(actor, { roll: roll.total, tn, target: targetActor, type: action });
  hobResult = mergeHoBResults(hobResult, aestheticHoB);
  const hobNotes = hobResult?.notes ?? [];
  if (hobResult?.tnAdjustments?.length) {
    const delta = hobResult.tnAdjustments.reduce((sum, adj) => sum + Number(adj.total || 0), 0);
    if (delta) {
      tn += delta;
    }
  }
  tn = applySpecialistTN(actor, tn, hp, hpMax);
  success = roll.total <= tn;

  if (targetActor) {
    await actor.setFlag(FLAG_SCOPE, "lastTargetName", targetActor.name || "");
  }

  const chipRoll = await (new Roll("1d10").evaluate({}));
  const chipData = await adjustChipDamage(actor, chipRoll, { action });
  const chipValue = chipData.total;

  await applyReloadingCooldown(actor, action, weaponKey, aggAttack.tags);

  if (!success) {
    let moraleResult = null;
    let damage = chipValue;
    if (guardContext) {
      const guardHpRoll = await (new Roll("1d20").evaluate({}));
      guardHpBonus = guardHpRoll.total;
      damage += guardHpBonus;
    }
    if (targetActor) {
      const res = await applyDamage(actor, targetActor, damage);
      moraleResult = res.moraleLoss;
      if ((res.hpDamage || 0) > 0) {
        await recordDamageTaken(targetActor, { hpDamage: res.hpDamage || 0 });
      }
      if (guardContext) {
        const protectedActor = guardContext.protectedActor;
        if (protectedActor) {
          await addEffect(protectedActor, {
            key: crypto.randomUUID?.() ?? randomID(),
            label: game.i18n.localize("W4SQ.EffectGuardWithdraw"),
            duration: 1,
            mods: { tags: { disengaged: true } }
          });
        }
        if (!targetActor.getFlag(FLAG_SCOPE, "unbreakable")) {
          const moraleRoll = await (new Roll("1d20").evaluate({}));
          guardMoraleBonus = moraleRoll.total;
          const morale = Number(getF(targetActor, "morale", 0));
          const moraleMax = Number(getF(targetActor, "moraleMax", 0));
          const nextMorale = clamp(morale - guardMoraleBonus, 0, moraleMax);
          await targetActor.setFlag(FLAG_SCOPE, "morale", nextMorale);
          moraleResult = (moraleResult || 0) + guardMoraleBonus;
          if (moraleMax > 0 && nextMorale / moraleMax < 0.5) {
            await ensureDisorganized(targetActor, { source: "guard" });
          }
        }
      }
    }
    const chipDetail = [game.i18n.localize("W4SQ.ChatChip")];
    if (guardContext) {
      const guardName = targetActor?.name ?? game.i18n.localize("W4SQ.UnknownSquad");
      const allyName = guardContext.protectedActor?.name ?? game.i18n.localize("W4SQ.UnknownSquad");
      chipDetail.push(game.i18n.format("W4SQ.ChatGuardRedirect", { guard: guardName, ally: allyName }));
      if (guardHpBonus) chipDetail.push(game.i18n.format("W4SQ.ChatGuardStrainHP", { total: guardHpBonus }));
      if (guardMoraleBonus) chipDetail.push(game.i18n.format("W4SQ.ChatGuardStrainMorale", { total: guardMoraleBonus }));
    }
    return sendActionMessage({
      actor,
      label: action === "melee" ? "Melee" : "Ranged",
      tn,
      rollTotal: roll.total,
      success: false,
      margin: tn - roll.total,
      dmg: damage,
      moraleLoss: moraleResult,
      soakDetail: chipDetail.join(" • ") || game.i18n.localize("W4SQ.ChatChip"),
      hobNotes,
      footer: `Role ${role} · Weapon ${weaponLabel} · EXP ${exp} · EQ ${eq}`
    });
  }

  const atkBase = await (new Roll(`1d20 + ${exp}d10`).evaluate({}));
  const atkWeapon = await rollMaybe(weapon.dmgDice);
  const atkRole = await rollMaybe(roleBonus.dmg);
  const atkEffect = await rollMaybe(aggAttack.dmgDice);
  const hobDamageBonus = (hobResult?.damageAdjustments ?? []).reduce((sum, adj) => sum + Number(adj.total || 0), 0);
  const damageMultiplier = Number(hobResult?.damageMultiplier || 1) || 1;

  let raw = atkBase.total + atkWeapon.total + atkRole.total;
  if (atkEffect.total === -0.5) {
    raw = raw / 2;
  } else {
    raw += atkEffect.total;
  }
  if (hobDamageBonus) {
    raw += hobDamageBonus;
  }
  if (damageMultiplier !== 1) {
    raw = Math.max(0, Math.round(raw * damageMultiplier));
  }

  const scaled = raw * hpScale(hp, Number(getF(actor, "hpMax", 1)));

  let defenseOnly = 0;
  let armor = 0;
  let rangedResist = 0;
  const soakNotes = [];
  let polearmBonus = 0;
  let counterSpear = 0;
  let deepDefenseBonus = 0;

  let aggDefense = null;
  let ignoreDefense = false;

  let backlineHpBonus = 0;
  let backlineMoraleBonus = 0;
  let guardHpBonus = 0;
  let guardMoraleBonus = 0;

  if (targetActor) {
    const targetExp = Number(getF(targetActor, "experienceTier", 0));
    const targetEq = Number(getF(targetActor, "equipmentTier", 0));
    const targetWeapon = getF(targetActor, "weapon", "sword");
    const ignoreTags = effectiveBackline ? ["braced", "antiCharge"] : [];
    const attackerTags = { ...(aggAttack.tags ?? {}), backlineAttack: effectiveBackline };
    if (attackerOrigin === "monster" && attackerPassives.monsterLurker && action === "melee") {
      attackerTags.forceFlanked = true;
    }
    aggDefense = aggregateForDefense(targetActor, { action, ignoreTags, attackerTags });
    ignoreDefense = !!aggDefense.tags?.noDefense;

    if (!ignoreDefense && targetExp > 0) {
      const defRoll = await (new Roll(`${targetExp}d6`).evaluate({}));
      defenseOnly += defRoll.total;
    }

    if (!ignoreDefense && isEngineer(targetActor)) {
      const deepRoll = await (new Roll("3d10").evaluate({}));
      defenseOnly += deepRoll.total;
      deepDefenseBonus = deepRoll.total;
    }

    if (!ignoreDefense) {
      const effDef = await rollMaybe(aggDefense.defSoakDice);
      if (effDef.total) {
        defenseOnly += effDef.total;
      }

      const effPen = await rollMaybe(aggDefense.defPenaltyDice);
      if (effPen.total) {
        defenseOnly += effPen.total;
      }
    }

    if (!(weapon.pierceArmor || aggAttack.tags?.pierceArmor)) {
      const armorDice = Math.min(targetEq, 10);
      if (armorDice > 0) {
        const armorRoll = await (new Roll(`${armorDice}d3`).evaluate({}));
        armor = armorRoll.total;
        const ignorePct = Number(aggAttack.tags?.armorIgnorePct || 0);
        if (ignorePct > 0) {
          const cut = Math.floor(armor * ignorePct);
          armor = Math.max(0, armor - cut);
        }
      }
    } else {
      armor = 0;
    }

    if (!ignoreDefense && targetWeapon === "polearm" && !effectiveBackline) {
      const pole = await (new Roll("1d20").evaluate({}));
      defenseOnly += pole.total;
      polearmBonus = pole.total;
    }

    if (action === "ranged") {
      if (weaponKey === "bow" || weaponKey === "crossbow") {
        const reduce = Math.floor(defenseOnly / 2);
        defenseOnly = Math.max(0, defenseOnly - reduce);
      }
      if (weaponKey === "firearm" || weaponKey === "artillery") {
        defenseOnly = 0;
      }
      const rr = await rollMaybe(aggDefense?.rangedResistDice);
      if (rr.total) {
        rangedResist += rr.total;
      }
    }

    if (action === "melee" && role === "mounted" && aggAttack.tags?.charged && aggDefense?.tags?.braced && targetWeapon === "polearm") {
      const counter = await (new Roll("2d20").evaluate({}));
      const aHPMax = Number(getF(actor, "hpMax", 1));
      const aHP = Number(getF(actor, "hp", 0));
      await actor.setFlag(FLAG_SCOPE, "hp", clamp(aHP - counter.total, 0, aHPMax));
      counterSpear = counter.total;
    }
    const defenseAdjust = await adjustDefenseSoak(targetActor, actor, {
      defenseOnly,
      armor,
      rangedResist,
      action,
      defenseTags: aggDefense?.tags
    });
    defenseOnly = defenseAdjust.defenseOnly;
    armor = defenseAdjust.armor;
    rangedResist = defenseAdjust.rangedResist;
  }

  let totalSoak = Math.max(0, defenseOnly) + Math.max(0, armor) + Math.max(0, rangedResist);
  let finalDamage = Math.max(chipValue, Math.floor(scaled - totalSoak));
  if (damageMultiplier !== 1) {
    finalDamage = Math.max(0, Math.floor(finalDamage * damageMultiplier));
  }
  if (aggAttack.tags?.halfDamage) {
    finalDamage = Math.floor(finalDamage / 2);
  }

  let moraleBonus = 0;
  let extraAttacks = 0;
  if (targetActor) {
    const attackAdjust = await adjustAttackDamage(actor, targetActor, {
      action,
      damageType: action,
      isMagical: Boolean(aggAttack.tags?.magical),
      isCharge: Boolean(aggAttack.tags?.charged),
      hpDamage: finalDamage
    });
    finalDamage = attackAdjust.damage;
    moraleBonus = attackAdjust.moraleBonus ?? 0;
    extraAttacks = attackAdjust.extraAttacks ?? 0;
    if (attackAdjust.armorPierceBonus) {
      finalDamage += attackAdjust.armorPierceBonus;
    }
    const incomingAdjust = await adjustIncomingDamage(targetActor, actor, {
      damage: finalDamage,
      moraleBonus,
      action,
      damageType: action,
      isMagical: Boolean(aggAttack.tags?.magical),
      isAoE: Boolean(aggAttack.tags?.aoe),
      isCharge: Boolean(aggAttack.tags?.charged)
    });
    finalDamage = incomingAdjust.damage;
    moraleBonus = incomingAdjust.moraleBonus;
  }

  if (success && targetActor && action === "melee" && effectiveBackline) {
    const hpBonusRoll = await (new Roll("2d10").evaluate({}));
    const moraleBonusRoll = await (new Roll("3d10").evaluate({}));
    backlineHpBonus = hpBonusRoll.total;
    backlineMoraleBonus = moraleBonusRoll.total;
    finalDamage += backlineHpBonus;
  }

  if (success && guardContext) {
    const guardHpRoll = await (new Roll("1d20").evaluate({}));
    guardHpBonus = guardHpRoll.total;
    finalDamage += guardHpBonus;
  }

  let moraleLoss = null;
  let totalHpDamageDealt = 0;

  if (targetActor) {
    if (aggAttack.tags?.multiShot) {
      const shots = Number(aggAttack.tags.multiShot) || 1;
      const per = aggAttack.tags.multiShotHalf ? Math.max(1, Math.floor(finalDamage / 2)) : finalDamage;
      for (let i = 0; i < shots; i++) {
        const res = await applyDamage(actor, targetActor, per, { moraleBonus, isMagical: Boolean(aggAttack.tags?.magical) });
        moraleLoss = res.moraleLoss;
        totalHpDamageDealt += res.hpDamage || 0;
        await recordDamageTaken(targetActor, { hpDamage: res.hpDamage || 0 });
      }
    } else {
      const res = await applyDamage(actor, targetActor, finalDamage, { moraleBonus, isMagical: Boolean(aggAttack.tags?.magical) });
      moraleLoss = res.moraleLoss;
      totalHpDamageDealt += res.hpDamage || 0;
      await recordDamageTaken(targetActor, { hpDamage: res.hpDamage || 0 });
    }
  }

  if (targetActor && success && extraAttacks > 0) {
    for (let i = 0; i < extraAttacks; i++) {
      const res = await applyDamage(actor, targetActor, finalDamage, { moraleBonus, isMagical: Boolean(aggAttack.tags?.magical) });
      moraleLoss = (moraleLoss || 0) + (res.moraleLoss || 0);
      totalHpDamageDealt += res.hpDamage || 0;
      await recordDamageTaken(targetActor, { hpDamage: res.hpDamage || 0 });
    }
  }

  if (guardContext) {
    const protectedActor = guardContext.protectedActor;
    if (protectedActor) {
      await addEffect(protectedActor, {
        key: crypto.randomUUID?.() ?? randomID(),
        label: game.i18n.localize("W4SQ.EffectGuardWithdraw"),
        duration: 1,
        mods: { tags: { disengaged: true } }
      });
    }
    if (!targetActor?.getFlag(FLAG_SCOPE, "unbreakable")) {
      const moraleRoll = await (new Roll("1d20").evaluate({}));
      guardMoraleBonus = moraleRoll.total;
      const morale = Number(getF(targetActor, "morale", 0));
      const moraleMax = Number(getF(targetActor, "moraleMax", 0));
      const nextMorale = clamp(morale - guardMoraleBonus, 0, moraleMax);
      await targetActor.setFlag(FLAG_SCOPE, "morale", nextMorale);
      moraleLoss = (moraleLoss || 0) + guardMoraleBonus;
      if (moraleMax > 0 && nextMorale / moraleMax < 0.5) {
        await ensureDisorganized(targetActor, { source: "guard" });
      }
    }
  }

  if (success && targetActor && action === "melee" && effectiveBackline && backlineMoraleBonus && !targetActor.getFlag(FLAG_SCOPE, "unbreakable")) {
    const morale = Number(getF(targetActor, "morale", 0));
    const moraleMax = Number(getF(targetActor, "moraleMax", 0));
    const nextMorale = clamp(morale - backlineMoraleBonus, 0, moraleMax);
    await targetActor.setFlag(FLAG_SCOPE, "morale", nextMorale);
    moraleLoss = (moraleLoss || 0) + backlineMoraleBonus;
    if (moraleMax > 0 && nextMorale / moraleMax < 0.5) {
      await ensureDisorganized(targetActor, { source: "backline" });
    }
  }

  if (targetActor) {
    const defenseTotal = Math.max(0, Math.floor(defenseOnly));
    const armorTotal = Math.max(0, Math.floor(armor));
    const resistTotal = Math.max(0, Math.floor(rangedResist));

    if (ignoreDefense) {
      soakNotes.push(game.i18n.localize("W4SQ.ChatDefenseStripped"));
    } else {
      soakNotes.push(game.i18n.format("W4SQ.ChatDefenseTotal", { total: defenseTotal }));
    }
    if (polearmBonus) {
      soakNotes.push(game.i18n.format("W4SQ.ChatDefensePolearm", { total: polearmBonus }));
    }
    if (armorTotal) {
      soakNotes.push(game.i18n.format("W4SQ.ChatArmorTotal", { total: armorTotal }));
    }
    if (resistTotal) {
      soakNotes.push(game.i18n.format("W4SQ.ChatRangedResist", { total: resistTotal }));
    }
    if (deepDefenseBonus) {
      soakNotes.push(game.i18n.format("W4SQ.ChatDeepDefense", { total: deepDefenseBonus }));
    }
  }
  if (counterSpear) {
    soakNotes.push(game.i18n.format("W4SQ.ChatCounterSpear", { total: counterSpear }));
  }
  if (guardContext) {
    const guardName = targetActor?.name ?? game.i18n.localize("W4SQ.UnknownSquad");
    const allyName = guardContext.protectedActor?.name ?? game.i18n.localize("W4SQ.UnknownSquad");
    soakNotes.push(game.i18n.format("W4SQ.ChatGuardRedirect", { guard: guardName, ally: allyName }));
    if (guardHpBonus) {
      soakNotes.push(game.i18n.format("W4SQ.ChatGuardStrainHP", { total: guardHpBonus }));
    }
    if (guardMoraleBonus) {
      soakNotes.push(game.i18n.format("W4SQ.ChatGuardStrainMorale", { total: guardMoraleBonus }));
    }
  }
  if (soakNotes.length) {
    soakNotes.push(game.i18n.format("W4SQ.ChatSoakTotal", { total: totalSoak }));
  }

  if (success && targetActor) {
    await applyPostAttackEffects({
      attacker: actor,
      defender: targetActor,
      success: true,
      action,
      isMagical: Boolean(aggAttack.tags?.magical),
      hpDamage: totalHpDamageDealt
    });
  }

  await sendActionMessage({
    actor,
    label: action === "melee" ? "Melee" : "Ranged",
    tn,
    rollTotal: roll.total,
    success: true,
    margin: tn - roll.total,
    dmg: finalDamage,
    moraleLoss,
    soakDetail: soakNotes.join(" • ") || game.i18n.localize("W4SQ.ChatNoSoak"),
    backline: effectiveBackline && action === "melee" && success,
    hobNotes,
    footer: `Role ${role} · Weapon ${weaponLabel} · EXP ${exp} · EQ ${eq}`
  });
}
