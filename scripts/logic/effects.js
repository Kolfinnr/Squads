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

const DISORG_BASE = {
  tnDice: "-1d20",
  dmgDice: "-1d20",
  defSoakDice: "-1d20"
};

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function effectHasTag(effect, tag) {
  return Boolean(effect?.mods?.tags?.[tag]);
}

function actorHasTag(actor, tag) {
  return getEffects(actor).some(effect => effectHasTag(effect, tag));
}

function hasAnyTag(effect, tags) {
  if (!tags || !effect?.mods?.tags) return false;
  for (const key of Object.keys(effect.mods.tags)) {
    if (tags.has(key)) return true;
  }
  return false;
}

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

function shouldBlockEffect(actor, effect) {
  const tags = effect?.mods?.tags ?? {};
  if (tags.flanked && (actorHasTag(actor, "immuneFlank") || actorHasTag(actor, "fortified"))) return true;
  if (tags.encircled && actorHasTag(actor, "immuneEncircle")) return true;
  return false;
}

export async function addEffect(actor, effect) {
  if (!actor || !effect) return;
  if (shouldBlockEffect(actor, effect)) return;
  const list = getEffects(actor);
  list.push(ensureKey(foundry.utils.duplicate(effect)));
  await actor.setFlag(FLAG_SCOPE, "effects", list);
}

export function actorHasEffect(actor, predicate) {
  if (!actor) return false;
  const effects = getEffects(actor);
  return effects.some(predicate);
}

export async function ensureEffect(actor, effect, predicate) {
  if (!actor) return;
  const exists = actorHasEffect(actor, predicate);
  if (exists) return;
  await addEffect(actor, effect);
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

function buildIgnoreSet(ignore) {
  if (!ignore) return new Set();
  if (ignore instanceof Set) return new Set(ignore);
  return new Set(ensureArray(ignore));
}

export function aggregateForAttack(actor, context = {}) {
  const { ignoreTags } = context;
  const ignore = buildIgnoreSet(ignoreTags);
  const effects = getEffects(actor);
  const ignorePenalties = effects.some(effect => effect?.mods?.tags?.ignorePenalties);
  const tnParts = [];
  const dmgParts = [];
  const tags = {};
  let hasTired = false;
  let hasDisorganized = false;
  for (const eff of effects) {
    const mods = eff.mods ?? {};
    if (ignore.size && hasAnyTag(eff, ignore)) continue;
    if (ignorePenalties && effectPolarity(eff) === "negative") {
      Object.assign(tags, mods.tags ?? {});
      continue;
    }
    pushDice(tnParts, mods.tnDice);
    pushDice(dmgParts, mods.dmgDice);
    if (mods.tags?.tired) hasTired = true;
    if (mods.tags?.disorganized) hasDisorganized = true;
    Object.assign(tags, mods.tags ?? {});
  }
  if (hasTired) {
    pushDice(tnParts, TIRED_BASE.tnDice);
    pushDice(dmgParts, TIRED_BASE.dmgDice);
  }
  if (hasDisorganized) {
    pushDice(tnParts, DISORG_BASE.tnDice);
    pushDice(dmgParts, DISORG_BASE.dmgDice);
  }
  return {
    tnDice: formatDiceFormula(tnParts),
    dmgDice: formatDiceFormula(dmgParts),
    tags
  };
}

export function aggregateForDefense(actor, options = {}) {
  const { action = "melee", ignoreTags, attackerTags } = options;
  const ignore = buildIgnoreSet(ignoreTags);
  const effects = getEffects(actor);
  const ignorePenalties = effects.some(effect => effect?.mods?.tags?.ignorePenalties);
  const defSoakParts = [];
  const defPenaltyParts = [];
  const rangedResistParts = [];
  const tags = {};
  let hasTired = false;
  let hasDisorganized = false;
  for (const eff of effects) {
    const mods = eff.mods ?? {};
    if (ignore.size && hasAnyTag(eff, ignore)) continue;
    if (ignorePenalties && effectPolarity(eff) === "negative") {
      Object.assign(tags, mods.tags ?? {});
      continue;
    }
    pushDice(defSoakParts, mods.defSoakDice);
    pushDice(defPenaltyParts, mods.defPenaltyDice);
    pushDice(rangedResistParts, mods.rangedResistDice);
    if (mods.tags?.tired) hasTired = true;
    if (mods.tags?.disorganized) hasDisorganized = true;
    Object.assign(tags, mods.tags ?? {});
    if (mods.tags?.fortified && action === "ranged") {
      pushDice(rangedResistParts, "+3d10");
    }
  }
  if (hasTired) {
    pushDice(defSoakParts, TIRED_BASE.defSoakDice);
  }
  if (hasDisorganized) {
    pushDice(defSoakParts, DISORG_BASE.defSoakDice);
  }
  if (attackerTags?.backlineAttack) {
    delete tags.flanked;
    delete tags.encircled;
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
  let hasDisorganized = false;
  for (const eff of effects) {
    if (ignorePenalties && effectPolarity(eff) === "negative") continue;
    const mods = eff.mods ?? {};
    pushDice(parts, mods.maneuverTNDice);
    if (mods.tags?.disorganized) hasDisorganized = true;
  }
  if (hasDisorganized) {
    pushDice(parts, DISORG_BASE.tnDice);
  }
  return formatDiceFormula(parts);
}

export async function ensureDisorganized(actor, { source = "auto" } = {}) {
  if (!actor) return;
  const has = actorHasEffect(actor, eff => effectHasTag(eff, "disorganized"));
  if (has) return;
  const label = source === "auto"
    ? game.i18n.localize("W4SQ.DisorganizedAuto")
    : game.i18n.localize("W4SQ.Disorganized") || "Disorganized";
  await addEffect(actor, {
    key: `disorg-${source}`,
    label,
    duration: 1,
    mods: { tags: { disorganized: true } }
  });
}

export async function removeDisorganized(actor) {
  if (!actor) return;
  const remaining = getEffects(actor).filter(effect => !effectHasTag(effect, "disorganized"));
  await actor.setFlag(FLAG_SCOPE, "effects", remaining);
}

export function hasFortified(actor) {
  return actorHasTag(actor, "fortified");
}
