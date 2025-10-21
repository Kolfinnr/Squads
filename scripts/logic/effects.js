import { FLAG_SCOPE } from "../config.js";

function ensureKey(effect) {
  if (!effect.key) {
    effect.key = crypto.randomUUID?.() ?? randomID();
  }
  return effect;
}

export function getEffects(actor) {
  return foundry.utils.duplicate(actor.getFlag(FLAG_SCOPE, "effects") ?? []);
}

export async function addEffect(actor, effect) {
  const list = getEffects(actor);
  list.push(ensureKey(foundry.utils.duplicate(effect)));
  await actor.setFlag(FLAG_SCOPE, "effects", list);
}

export async function removeEffectByKey(actor, key) {
  const list = getEffects(actor).filter(e => e.key !== key);
  await actor.setFlag(FLAG_SCOPE, "effects", list);
}

export async function clearNegative(actor) {
  const list = getEffects(actor).filter(e => {
    const tags = e?.mods?.tags ?? {};
    if (tags.disorganized) return false;
    if (tags.tired) return false;
    if (tags.flanked) return false;
    if (tags.encircled) return false;
    return true;
  });
  await actor.setFlag(FLAG_SCOPE, "effects", list);
}

export async function tickEffects(actor) {
  const next = [];
  for (const eff of getEffects(actor)) {
    const duration = Number(eff.duration ?? 0);
    if (duration <= 1) {
      const buff = eff?.mods?.tags?.nextRoundBuff;
      if (buff) {
        const follow = {
          key: `${eff.key}-next`,
          label: eff.label ?? "Follow-up",
          duration: 1,
          mods: { ...buff }
        };
        next.push(follow);
      }
      continue;
    }
    next.push({ ...eff, duration: duration - 1 });
  }
  await actor.setFlag(FLAG_SCOPE, "effects", next);
}

function appendDice(base, value) {
  const str = (value ?? "0").toString().trim();
  if (!str || str === "0") return base;
  if (!base) return str;
  const joiner = str.startsWith("-") ? " " : " + ";
  return `${base}${joiner}${str}`;
}

export function aggregateForAttack(actor) {
  const agg = { tnDice: "0", dmgDice: "0", tags: {} };
  for (const eff of getEffects(actor)) {
    const mods = eff.mods ?? {};
    if (mods.tnDice) agg.tnDice = appendDice(agg.tnDice, mods.tnDice);
    if (mods.dmgDice) agg.dmgDice = appendDice(agg.dmgDice, mods.dmgDice);
    Object.assign(agg.tags, mods.tags ?? {});
  }
  agg.tnDice = agg.tnDice.trim() || "0";
  agg.dmgDice = agg.dmgDice.trim() || "0";
  return agg;
}

export function aggregateForDefense(actor) {
  const agg = { defSoakDice: "0", defPenaltyDice: "0", rangedResistDice: "0", tags: {} };
  for (const eff of getEffects(actor)) {
    const mods = eff.mods ?? {};
    if (mods.defSoakDice) agg.defSoakDice = appendDice(agg.defSoakDice, mods.defSoakDice);
    if (mods.defPenaltyDice) agg.defPenaltyDice = appendDice(agg.defPenaltyDice, mods.defPenaltyDice);
    if (mods.rangedResistDice) agg.rangedResistDice = appendDice(agg.rangedResistDice, mods.rangedResistDice);
    Object.assign(agg.tags, mods.tags ?? {});
  }
  agg.defSoakDice = agg.defSoakDice.trim() || "0";
  agg.defPenaltyDice = agg.defPenaltyDice.trim() || "0";
  agg.rangedResistDice = agg.rangedResistDice.trim() || "0";
  return agg;
}

export function aggregateForManeuvers(actor) {
  let dice = "0";
  for (const eff of getEffects(actor)) {
    const mods = eff.mods ?? {};
    if (mods.maneuverTNDice) {
      dice = appendDice(dice, mods.maneuverTNDice);
    }
  }
  return dice.trim() || "0";
}
