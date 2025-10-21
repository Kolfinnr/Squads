// scripts/features/actions.js
import { ROLL, FLAG_SCOPE, DEFAULTS, WEAPONS, ROLES, SCALING } from "../config.js";
import { sendActionMessage } from "../services/chat.js";
import { aggregateForAttack, aggregateForDefense, tickEffects } from "../logic/effects.js";
import { tickCooldowns } from "../logic/cooldowns.js";

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const clampTN = (tn) => Math.min(ROLL.maxTN, Math.max(ROLL.minTN, tn));
const getF = (actor, k, d) => actor.getFlag(FLAG_SCOPE, k) ?? d;

async function rollMaybe(expr) {
  const s = (expr || "").trim();
  if (!s || s === "0") return { total: 0, formula: "0" };
  if (s === "-1/2") return { total: -0.5, formula: "-1/2" }; // special marker for “half damage”
  const r = await (new Roll(s).roll({ async: true }));
  return { total: r.total, formula: r.formula };
}

function hpScale(cur, max) {
  const ratio = Math.max(0, Math.min(1, Number(cur) / Math.max(1, Number(max))));
  return SCALING.hpFloor + (1 - SCALING.hpFloor) * ratio; // 20% floor
}

function roleBonuses(role, action){
  switch (role) {
    case "infantry":
    case "mounted": return (action === "melee") ? { acc: "+1d10", dmg: "+1d10" } : { acc: "0", dmg: "0" };
    case "ranged":
      if (action === "ranged") return { acc: "+1d10", dmg: "+1d10" };
      if (action === "melee")  return { acc: "-1d20", dmg: "-1d20" };
      return { acc: "0", dmg: "0" };
    default: return { acc: "0", dmg: "0" };
  }
}

async function applyDamageToTarget(actor, finalDamage) {
  const targets = [...game.user.targets];
  if (targets.length !== 1) return { applied: false };

  const t = targets[0].actor;
  let hp     = t.getFlag(FLAG_SCOPE, "hp");
  let hpMax  = t.getFlag(FLAG_SCOPE, "hpMax");
  let morale = t.getFlag(FLAG_SCOPE, "morale");
  let morMax = t.getFlag(FLAG_SCOPE, "moraleMax");

  if (typeof hp !== "number" || typeof hpMax !== "number") return { applied: false };

  await t.setFlag(FLAG_SCOPE, "hp", clamp(hp - finalDamage, 0, hpMax));

  // morale takes equal damage + 1d20 (fear/terror later)
  const extra = await (new Roll("1d20").roll({ async: true }));
  const moraleLoss = finalDamage + extra.total;
  if (typeof morale === "number" && typeof morMax === "number") {
    await t.setFlag(FLAG_SCOPE, "morale", clamp(morale - moraleLoss, 0, morMax));
  }
  return { applied: true, moraleLoss, target: t };
}

export async function doSquadAction(actor, action){
  const exp   = Number(getF(actor, "experienceTier", DEFAULTS.experienceTier));
  const eq    = Number(getF(actor, "equipmentTier", DEFAULTS.equipmentTier));
  const role  = getF(actor, "role",   DEFAULTS.role);
  const wKey  = getF(actor, "weapon", DEFAULTS.weapon);
  const wDef  = WEAPONS[wKey] ?? WEAPONS.sword;
  const rDef  = ROLES[role] ?? ROLES.infantry;

  const aggA  = aggregateForAttack(actor, { action });
  const roleB = roleBonuses(role, action);

  // ----- TN -----
  const wAcc   = await rollMaybe(wDef.accuracyDice);
  const roleAcc= await rollMaybe(roleB.acc);
  const effAcc = await rollMaybe(aggA.tnDice);
  const hybrid = rDef.hybridPenalty ? (await rollMaybe("-1d10")).total : 0;

  let tn = 40 + (exp * 7) + (eq * 5) + wAcc.total + roleAcc.total + effAcc.total + hybrid;

  // situational TN nudges
  const m = Number(getF(actor,"morale",0)), mMax = Number(getF(actor,"moraleMax",1));
  if (mMax > 0 && m / mMax < 0.30) tn -= 10;
  if (Number(getF(actor,"hp",0)) <= 0) tn -= 20;
  tn = clampTN(tn);

  const d100 = await (new Roll("1d100").roll({ async: true }));
  const success = d100.total <= tn;
  const margin = tn - d100.total;

  if (!success){
  // New: chip damage still applies on a miss
  const chip = await (new Roll("1d10").roll({ async: true }));
  let moraleLoss = null;

  // Apply only if exactly one target is selected (same as on-hit)
  const targets = [...game.user.targets];
  if (targets.length === 1) {
    const res = await (async () => {
      const t = targets[0].actor;
      // HP
      const hp    = t.getFlag(FLAG_SCOPE, "hp") ?? 0;
      const hpMax = t.getFlag(FLAG_SCOPE, "hpMax") ?? 0;
      await t.setFlag(FLAG_SCOPE, "hp", clamp(hp - chip.total, 0, hpMax));
      // Morale = equal + 1d20
      const bump = await (new Roll("1d20").roll({ async: true }));
      const mor    = t.getFlag(FLAG_SCOPE, "morale") ?? 0;
      const morMax = t.getFlag(FLAG_SCOPE, "moraleMax") ?? 0;
      const newMor = clamp(mor - (chip.total + bump.total), 0, morMax);
      await t.setFlag(FLAG_SCOPE, "morale", newMor);
      return { moraleLoss: chip.total + bump.total };
    })();
    moraleLoss = res.moraleLoss;
  }

  await tickEffects(actor);
  await tickCooldowns(actor);

  return sendActionMessage({
    actor,
    label: (action === "melee" ? "Melee" : "Ranged"),
    tn, rollTotal: d100.total, success: false, margin,
    dmg: chip.total,                      // show chip dealt
    moraleLoss,                           // may be null if no target selected
    soakDetail: "Miss: chip damage applied (1d10).",
    footer: `Role ${role} · Weapon ${wKey} · EXP ${exp} · EQ ${eq}`
  });
}


  // ----- Attack Dice -----
  const atkBase = await (new Roll(`1d20 + ${exp}d10`).roll({ async: true }));
  const atkWpn  = await rollMaybe(wDef.dmgDice);
  const atkRole = await rollMaybe(roleB.dmg);
  const atkEff  = await rollMaybe(aggA.dmgDice);

  let raw = atkBase.total + atkWpn.total + atkRole.total + (atkEff.total > -1 ? atkEff.total : 0);
  // special half-damage marker (-1/2)
  if (atkEff.total === -0.5) raw = raw / 2;

  // scale by attacker HP with 20% floor
  const scaled = raw * hpScale(getF(actor,"hp",0), getF(actor,"hpMax",1));

  // ----- Soak / Defense -----
  let defSoak = 0; let defText = []; let defenseOnly = 0;
  const targets = [...game.user.targets];
  const armorIgnorePct = aggA.tags?.armorIgnorePct || 0;

  if (targets.length === 1) {
    const t = targets[0].actor;
    const tExp = Number(getF(t,"experienceTier",0));
    const tEq  = Number(getF(t,"equipmentTier",0));
    const tW   = getF(t,"weapon","sword");
    const aggD = aggregateForDefense(t, { action });

    const dDef = await (new Roll(`${tExp}d6`).roll({ async: true }));
    defenseOnly += dDef.total;
    defSoak     += dDef.total; defText.push(`Defense ${tExp}d6=${dDef.total}`);

    const effAdd = await rollMaybe(aggD.defSoakDice);
    if (effAdd.total) { defSoak += effAdd.total; defText.push(`Effects +(${effAdd.formula})=${effAdd.total}`); }
    const effPen = await rollMaybe(aggD.defPenaltyDice);
    if (effPen.total) { defSoak += effPen.total; defText.push(`Effects (${effPen.formula})=${effPen.total}`); }

    // Armor soak d3 per EQ, cap 10; subtract % ignored
    const pierce = wDef.pierceArmor || aggA.tags?.pierceArmor;
    if (!pierce) {
      const dice = Math.min(tEq, 10);
      const arm  = await (new Roll(`${dice}d3`).roll({ async: true }));
      let armTotal = arm.total;
      if (armorIgnorePct > 0) {
        const cut = Math.floor(armTotal * armorIgnorePct);
        armTotal = Math.max(0, armTotal - cut);
        defText.push(`Armor ignore ${Math.round(armorIgnorePct*100)}%: -${cut}`);
      }
      defSoak += armTotal; defText.push(`Armor ${dice}d3=${armTotal}`);
    } else {
      defText.push(`Armor ignored`);
    }

    // Polearm defenders get +1d20 DEF
    if (tW === "polearm") {
      const p = await (new Roll("1d20").roll({ async: true }));
      defSoak += p.total; defenseOnly += p.total;
      defText.push(`Polearm defense +1d20=${p.total}`);
    }

    // Ranged overrides
    if (action === "ranged") {
      if (wKey === "bow" || wKey === "crossbow") {
        const reduce = Math.floor(defenseOnly / 2);
        defText.push(`Bow/Xbow halves defense soak −${reduce}`);
        defSoak = Math.max(0, defSoak - reduce);
      }
      if (wKey === "firearm" || wKey === "artillery") {
        defText.push(`Firearm/Artillery ignores defense soak −${defenseOnly}`);
        defSoak = Math.max(0, defSoak - defenseOnly);
      }
      const rr = await rollMaybe(aggD.rangedResistDice);
      if (rr.total) { defSoak += rr.total; defText.push(`Ranged resist +(${rr.formula})=${rr.total}`); }
    }

    // Mounted charge into braced polearms (counter)
    const attackerHasCharge = aggA.tags?.charged;
    const defenderBraced    = aggD.tags?.braced;
    if (action === "melee" && role === "mounted" && attackerHasCharge && defenderBraced && tW === "polearm") {
      const counter = await (new Roll("2d20").roll({ async: true }));
      const aHP = Number(getF(actor,"hp",0)), aMax = Number(getF(actor,"hpMax",1));
      await actor.setFlag(FLAG_SCOPE, "hp", clamp(aHP - counter.total, 0, aMax));
      defText.push(`Counter-spear on charge: attacker suffers ${counter.total}`);
    }
  }

  // Chip damage ensures a minimum hit
  const chip = await (new Roll("1d10").roll({ async: true }));
  let finalDamage = Math.max(chip.total, Math.floor(scaled - defSoak));
  if (aggA.tags?.halfDamage) finalDamage = Math.floor(finalDamage / 2);

  // Volley: apply twice at half (if set)
  let moraleLoss = null;
  if (aggA.tags?.multiShot) {
    const shots = aggA.tags.multiShot;
    const per   = aggA.tags.multiShotHalf ? Math.max(1, Math.floor(finalDamage / 2)) : finalDamage;
    for (let i = 0; i < shots; i++) {
      const res = await applyDamageToTarget(actor, per);
      moraleLoss = res.moraleLoss;
    }
  } else {
    const res = await applyDamageToTarget(actor, finalDamage);
    moraleLoss = res.moraleLoss;
  }

  await tickEffects(actor);
  await tickCooldowns(actor);

  // Chat summary
  await sendActionMessage({
    actor,
    label: (action === "melee" ? "Melee" : "Ranged"),
    tn, rollTotal: d100.total, success: true, margin,
    dmg: finalDamage, moraleLoss,
    soakDetail: `Atk: base=${atkBase.total} wpn=${atkWpn.total} role=${atkRole.total} eff=${atkEff.total} → scaled=${scaled.toFixed(1)}; Soak=${defSoak}; Chip=${chip.total}`,
    footer: `Role ${role} · Weapon ${wKey} · EXP ${exp} · EQ ${eq}`
  });
}
