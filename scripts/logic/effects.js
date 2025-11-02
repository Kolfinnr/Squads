import { FLAG_SCOPE } from "../config.js";

const NEGATIVE_TAGS = new Set([
  "tired",
  "disorganized",
  "flanked",
  "encircled",
  "skipTurn",
  "halfDamage"
]);

const NEGATIVE_DICE_KEYS = [
  "tnDice",
  "dmgDice",
  "defSoakDice",
  "defPenaltyDice",
  "rangedResistDice",
  "maneuverTNDice"
];

function ensureKey(effect) {
  if (!effect.key) {
    effect.key = crypto.randomUUID?.() ?? randomID();
  }
  return effect;
}

export function getEffects(actor) {
  return foundry.utils.duplicate(actor.getFlag(FLAG_SCOPE, "effects") ?? []);
}

export function effectPolarity(effect) {
  const mods = effect?.mods ?? {};
  const tags = mods.tags ?? {};
  for (const tag of Object.keys(tags)) {
    if (NEGATIVE_TAGS.has(tag) && tags[tag]) return "negative";
  }
  for (const key of NEGATIVE_DICE_KEYS) {
    const value = mods[key];
    if (typeof value === "string" && value.trim().startsWith("-")) {
      return "negative";
    }
  }
  const label = (effect?.label || "").toLowerCase();
  if (label.includes("penalty") || label.includes("disorganized")) return "negative";
  return "positive";
}

export function getEffectsDetailed(actor) {
  return getEffects(actor).map(effect => ({
    ...effect,
    polarity: effectPolarity(effect)
  }));
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
    if (effectPolarity(e) === "negative") return false;
    const label = (e.label || "").toLowerCase();
    if (label.includes("disorganized")) return false;
    if ((e.key || "").includes("disorg")) return false;
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

export function aggregateForAttack(actor, context = {}) {
  const agg = { tnDice: "0", dmgDice: "0", tags: {} };
  const effects = getEffects(actor);
  let needsTiredPenalty = false;
  for (const eff of effects) {
    const mods = eff.mods ?? {};
    if (mods.tnDice) agg.tnDice = appendDice(agg.tnDice, mods.tnDice);
    if (mods.dmgDice) agg.dmgDice = appendDice(agg.dmgDice, mods.dmgDice);
    if (mods.tags?.tired && !mods.tnDice) needsTiredPenalty = true;
    Object.assign(agg.tags, mods.tags ?? {});
  }
  const action = context.action;
  const weapon = context.weapon;
  if (needsTiredPenalty && action === "ranged" && (weapon === "bow" || weapon === "crossbow")) {
    agg.tnDice = appendDice(agg.tnDice, "-1d10");
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
