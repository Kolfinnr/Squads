import { FLAG_SCOPE, DEFAULT_FLAGS, WEAPONS, ROLES, ROLL, SCALING } from "../config.js";
import { aggregateForAttack, aggregateForDefense, tickEffects } from "../logic/effects.js";
import { tickCooldowns } from "../logic/cooldowns.js";
import { sendActionMessage } from "../services/chat.js";
import { maybeTriggerHoB } from "../logic/hob.js";

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const clampTN = (tn) => Math.min(ROLL.maxTN, Math.max(ROLL.minTN, tn));

const getF = (actor, key, def) => actor.getFlag(FLAG_SCOPE, key) ?? foundry.utils.getProperty(DEFAULT_FLAGS, key) ?? def;

async function rollMaybe(expr) {
  const s = (expr || "").toString().trim();
  if (!s || s === "0") return { total: 0, formula: "0" };
  if (s === "-1/2") return { total: -0.5, formula: "-1/2" };
  const r = await (new Roll(s).roll({ async: true }));
  return { total: r.total, formula: r.formula };
}

function hpScale(cur, max) {
  const ratio = Math.max(0, Math.min(1, Number(max) ? Number(cur) / Number(max) : 0));
  return SCALING.hpFloor + (1 - SCALING.hpFloor) * ratio;
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
    default:
      return { acc: "0", dmg: "0" };
  }
}

async function moraleLossFor(defender, attacker, finalDamage) {
  if (defender.getFlag(FLAG_SCOPE, "unbreakable")) return null;
  const base = finalDamage;
  const extraRoll = await (new Roll("1d20").roll({ async: true }));
  let total = base + extraRoll.total;
  const extras = [];
  if (attacker.getFlag(FLAG_SCOPE, "fear")) {
    const fearRoll = await (new Roll("1d10").roll({ async: true }));
    total += fearRoll.total;
    extras.push(fearRoll.total);
  }
  if (attacker.getFlag(FLAG_SCOPE, "terror")) {
    const terrorRoll = await (new Roll("3d10").roll({ async: true }));
    total += terrorRoll.total;
    extras.push(terrorRoll.total);
  }
  const defenderTerror = defender.getFlag(FLAG_SCOPE, "terror");
  if (defenderTerror && attacker.getFlag(FLAG_SCOPE, "fear") && !attacker.getFlag(FLAG_SCOPE, "terror")) {
    const counter = await (new Roll("1d10").roll({ async: true }));
    total += counter.total;
    extras.push(counter.total);
  }
  const moraleMax = Number(defender.getFlag(FLAG_SCOPE, "moraleMax") || 0);
  const morale = Number(defender.getFlag(FLAG_SCOPE, "morale") || 0);
  const next = clamp(morale - total, 0, moraleMax);
  await defender.setFlag(FLAG_SCOPE, "morale", next);
  return total;
}

async function applyDamage(actor, defender, finalDamage) {
  const hpMax = Number(defender.getFlag(FLAG_SCOPE, "hpMax") || 0);
  const hp = Number(defender.getFlag(FLAG_SCOPE, "hp") || 0);
  const next = clamp(hp - finalDamage, 0, hpMax);
  await defender.setFlag(FLAG_SCOPE, "hp", next);
  const moraleLoss = await moraleLossFor(defender, actor, finalDamage);
  await actor.setFlag(FLAG_SCOPE, "lastTargetName", defender.name || "");
  return { moraleLoss };
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
  const weaponKey = getF(actor, "weapon", "sword");
  const weapon = WEAPONS[weaponKey] ?? WEAPONS.sword;
  const roleDef = ROLES[role] ?? ROLES.infantry;

  const aggAttack = aggregateForAttack(actor, { action });
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
  if (moraleMax > 0 && morale / moraleMax < 0.3) tn -= 10;
  if (hp <= 0) tn -= 20;
  tn = clampTN(tn);

  const roll = await (new Roll("1d100").roll({ async: true }));
  const success = roll.total <= tn;
  await maybeTriggerHoB(actor, { roll: roll.total, success });

  const targetActor = selectedTarget();
  if (targetActor) {
    await actor.setFlag(FLAG_SCOPE, "lastTargetName", targetActor.name || "");
  }

  const chip = await (new Roll("1d10").roll({ async: true }));

  if (!success) {
    let moraleResult = null;
    if (targetActor) {
      const res = await applyDamage(actor, targetActor, chip.total);
      moraleResult = res.moraleLoss;
    }
    await tickEffects(actor);
    await tickCooldowns(actor);
    return sendActionMessage({
      actor,
      label: action === "melee" ? "Melee" : "Ranged",
      tn,
      rollTotal: roll.total,
      success: false,
      margin: tn - roll.total,
      dmg: chip.total,
      moraleLoss: moraleResult,
      soakDetail: game.i18n.localize("W4SQ.ChatChip"),
      footer: `Role ${role} · Weapon ${weaponKey} · EXP ${exp} · EQ ${eq}`
    });
  }

  const atkBase = await (new Roll(`1d20 + ${exp}d10`).roll({ async: true }));
  const atkWeapon = await rollMaybe(weapon.dmgDice);
  const atkRole = await rollMaybe(roleBonus.dmg);
  const atkEffect = await rollMaybe(aggAttack.dmgDice);

  let raw = atkBase.total + atkWeapon.total + atkRole.total;
  if (atkEffect.total === -0.5) {
    raw = raw / 2;
  } else {
    raw += atkEffect.total;
  }

  const scaled = raw * hpScale(hp, Number(getF(actor, "hpMax", 1)));

  let defenseOnly = 0;
  let armor = 0;
  let rangedResist = 0;
  const soakNotes = [];
  let baseDefense = 0;
  let defenseEffect = 0;
  let defensePenalty = 0;
  let polearmBonus = 0;
  let bowReduction = 0;
  let firearmIgnore = 0;
  let armorCut = 0;
  let armorSource = 0;
  let armorPierced = false;
  let rangedResistTotal = 0;
  let counterSpear = 0;

  if (targetActor) {
    const targetExp = Number(getF(targetActor, "experienceTier", 0));
    const targetEq = Number(getF(targetActor, "equipmentTier", 0));
    const targetWeapon = getF(targetActor, "weapon", "sword");
    const aggDefense = aggregateForDefense(targetActor, { action });

    if (targetExp > 0) {
      const defRoll = await (new Roll(`${targetExp}d6`).roll({ async: true }));
      defenseOnly += defRoll.total;
      baseDefense = defRoll.total;
    }

    const effDef = await rollMaybe(aggDefense.defSoakDice);
    if (effDef.total) {
      defenseOnly += effDef.total;
      defenseEffect += effDef.total;
    }

    const effPen = await rollMaybe(aggDefense.defPenaltyDice);
    if (effPen.total) {
      defenseOnly += effPen.total;
      defensePenalty += effPen.total;
    }

    if (!(weapon.pierceArmor || aggAttack.tags?.pierceArmor)) {
      const armorDice = Math.min(targetEq, 10);
      if (armorDice > 0) {
        const armorRoll = await (new Roll(`${armorDice}d3`).roll({ async: true }));
        armor = armorRoll.total;
        armorSource = armorRoll.total;
        const ignorePct = Number(aggAttack.tags?.armorIgnorePct || 0);
        if (ignorePct > 0) {
          const cut = Math.floor(armor * ignorePct);
          armor = Math.max(0, armor - cut);
          armorCut = cut;
        }
      }
    } else {
      armorPierced = true;
      armor = 0;
    }

    if (targetWeapon === "polearm") {
      const pole = await (new Roll("1d20").roll({ async: true }));
      defenseOnly += pole.total;
      polearmBonus = pole.total;
    }

    if (action === "ranged") {
      if (weaponKey === "bow" || weaponKey === "crossbow") {
        const reduce = Math.floor(defenseOnly / 2);
        defenseOnly = Math.max(0, defenseOnly - reduce);
        bowReduction = reduce;
      }
      if (weaponKey === "firearm" || weaponKey === "artillery") {
        firearmIgnore = defenseOnly;
        defenseOnly = 0;
      }
      const rr = await rollMaybe(aggDefense.rangedResistDice);
      if (rr.total) {
        rangedResist += rr.total;
        rangedResistTotal += rr.total;
      }
    }

    if (action === "melee" && role === "mounted" && aggAttack.tags?.charged && aggDefense.tags?.braced && targetWeapon === "polearm") {
      const counter = await (new Roll("2d20").roll({ async: true }));
      const aHPMax = Number(getF(actor, "hpMax", 1));
      const aHP = Number(getF(actor, "hp", 0));
      await actor.setFlag(FLAG_SCOPE, "hp", clamp(aHP - counter.total, 0, aHPMax));
      counterSpear = counter.total;
    }
  }

  let totalSoak = Math.max(0, defenseOnly) + Math.max(0, armor) + Math.max(0, rangedResist);
  let finalDamage = Math.max(chip.total, Math.floor(scaled - totalSoak));
  if (aggAttack.tags?.halfDamage) {
    finalDamage = Math.floor(finalDamage / 2);
  }

  let moraleLoss = null;
  if (targetActor) {
    if (aggAttack.tags?.multiShot) {
      const shots = Number(aggAttack.tags.multiShot) || 1;
      const per = aggAttack.tags.multiShotHalf ? Math.max(1, Math.floor(finalDamage / 2)) : finalDamage;
      for (let i = 0; i < shots; i++) {
        const res = await applyDamage(actor, targetActor, per);
        moraleLoss = res.moraleLoss;
      }
    } else {
      const res = await applyDamage(actor, targetActor, finalDamage);
      moraleLoss = res.moraleLoss;
    }
  }

  if (baseDefense) {
    soakNotes.push(game.i18n.format("W4SQ.ChatDefenseBase", { total: baseDefense }));
  }
  if (defenseEffect) {
    soakNotes.push(game.i18n.format("W4SQ.ChatDefenseEffect", { total: defenseEffect }));
  }
  if (defensePenalty) {
    soakNotes.push(game.i18n.format("W4SQ.ChatDefensePenalty", { total: defensePenalty }));
  }
  if (polearmBonus) {
    soakNotes.push(game.i18n.format("W4SQ.ChatDefensePolearm", { total: polearmBonus }));
  }
  if (bowReduction) {
    soakNotes.push(game.i18n.format("W4SQ.ChatDefenseBow", { total: bowReduction }));
  }
  if (firearmIgnore) {
    soakNotes.push(game.i18n.format("W4SQ.ChatDefenseFirearm", { total: firearmIgnore }));
  }
  if (armorSource && !firearmIgnore) {
    soakNotes.push(game.i18n.format("W4SQ.ChatArmorBase", { total: armorSource }));
  }
  if (armorCut) {
    soakNotes.push(game.i18n.format("W4SQ.ChatArmorCut", { total: armorCut }));
  }
  if (armorPierced) {
    soakNotes.push(game.i18n.localize("W4SQ.ChatArmorPierced"));
  }
  if (rangedResistTotal) {
    soakNotes.push(game.i18n.format("W4SQ.ChatRangedResistTotal", { total: rangedResistTotal }));
  }
  if (counterSpear) {
    soakNotes.push(game.i18n.format("W4SQ.ChatCounterSpear", { total: counterSpear }));
  }
  if (soakNotes.length) {
    soakNotes.push(game.i18n.format("W4SQ.ChatSoakTotal", { total: totalSoak }));
  }

  await tickEffects(actor);
  await tickCooldowns(actor);

  await sendActionMessage({
    actor,
    label: action === "melee" ? "Melee" : "Ranged",
    tn,
    rollTotal: roll.total,
    success: true,
    margin: tn - roll.total,
    dmg: finalDamage,
    moraleLoss,
    soakDetail: soakNotes.join("<br/>") || game.i18n.localize("W4SQ.ChatNoSoak"),
    footer: `Role ${role} · Weapon ${weaponKey} · EXP ${exp} · EQ ${eq}`
  });
}
