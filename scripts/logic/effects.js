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

const TIRED_BASE = {
  tnDice: "-1d10",
  dmgDice: "-1d10",
  defSoakDice: "-1d20"
};

function pushDice(parts, value) {
  const str = (value ?? "").toString().trim();
  if (!str || str === "0") return;
  parts.push(str);
}

function formatDiceFormula(parts) {
  const cleaned = parts
    .map(part => part?.toString()?.trim?.() ?? "")
    .filter(part => part.length);
  if (!cleaned.length) return "0";
  return cleaned
    .map((part, index) => {
      if (index === 0) {
        if (part.startsWith("+")) return part.slice(1).trim() || "0";
        if (part.startsWith("-")) return `-${part.slice(1).trim()}`;
        return part;
      }
      if (part.startsWith("+")) return `+ ${part.slice(1).trim()}`;
      if (part.startsWith("-")) return `- ${part.slice(1).trim()}`;
      return `+ ${part}`;
    })
    .join(" ");
}

function ensureKey(effect) {
  if (!effect.key) {
    effect.key = crypto.randomUUID?.() ?? randomID();
  }
  return effect;
}

function createTiredFollowUp(label, extraTags = {}) {
  return ensureKey({
    label,
    duration: 1,
    mods: {
      tags: { tired: true, ...extraTags }
    }
  });
}

function followUpsForExpired(effect) {
  const key = effect?.key;
  switch (key) {
    case "bow-volley":
    case "xbow-volley":
      return [createTiredFollowUp("Tired")];
    case "mordhau":
      return [createTiredFollowUp("Mordhau Fatigue")];
    case "rage":
      return [createTiredFollowUp("Spent", { disorganized: true })];
    default:
      return [];
  }
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
      for (const follow of followUpsForExpired(eff)) {
        next.push(follow);
      }
      continue;
    }
    next.push({ ...eff, duration: duration - 1 });
  }
  await actor.setFlag(FLAG_SCOPE, "effects", next);
}

export function aggregateForAttack(actor, context = {}) {
  const effects = getEffects(actor);
  const ignorePenalties = effects.some(effect => effect?.mods?.tags?.ignorePenalties);
  const tnParts = [];
  const dmgParts = [];
  const tags = {};
  let hasTired = false;
  for (const eff of effects) {
    const mods = eff.mods ?? {};
    if (ignorePenalties && effectPolarity(eff) === "negative") {
      Object.assign(tags, mods.tags ?? {});
      continue;
    }
    pushDice(tnParts, mods.tnDice);
    pushDice(dmgParts, mods.dmgDice);
    if (mods.tags?.tired) hasTired = true;
    Object.assign(tags, mods.tags ?? {});
  }
  if (hasTired) {
    pushDice(tnParts, TIRED_BASE.tnDice);
    pushDice(dmgParts, TIRED_BASE.dmgDice);
  }
  return {
    tnDice: formatDiceFormula(tnParts),
    dmgDice: formatDiceFormula(dmgParts),
    tags
  };
}

export function aggregateForDefense(actor) {
  const effects = getEffects(actor);
  const ignorePenalties = effects.some(effect => effect?.mods?.tags?.ignorePenalties);
  const defSoakParts = [];
  const defPenaltyParts = [];
  const rangedResistParts = [];
  const tags = {};
  let hasTired = false;
  for (const eff of effects) {
    const mods = eff.mods ?? {};
    if (ignorePenalties && effectPolarity(eff) === "negative") {
      Object.assign(tags, mods.tags ?? {});
      continue;
    }
    pushDice(defSoakParts, mods.defSoakDice);
    pushDice(defPenaltyParts, mods.defPenaltyDice);
    pushDice(rangedResistParts, mods.rangedResistDice);
    if (mods.tags?.tired) hasTired = true;
    Object.assign(tags, mods.tags ?? {});
  }
  if (hasTired) {
    pushDice(defSoakParts, TIRED_BASE.defSoakDice);
  }
  return {
    defSoakDice: formatDiceFormula(defSoakParts),
    defPenaltyDice: formatDiceFormula(defPenaltyParts),
    rangedResistDice: formatDiceFormula(rangedResistParts),
    tags
  };
}

export function aggregateForManeuvers(actor) {
  const effects = getEffects(actor);
  const ignorePenalties = effects.some(effect => effect?.mods?.tags?.ignorePenalties);
  const parts = [];
  for (const eff of effects) {
    if (ignorePenalties && effectPolarity(eff) === "negative") continue;
    const mods = eff.mods ?? {};
    pushDice(parts, mods.maneuverTNDice);
  }
  return formatDiceFormula(parts);
}
