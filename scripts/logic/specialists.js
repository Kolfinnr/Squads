import { FLAG_SCOPE, SPECIALIST_TYPES } from "../config.js";
import { addEffect, ensureDisorganized } from "./effects.js";
import { createAoEFromEffect } from "../aoe.js";

function logDebug(...args) {
  if (globalThis.console?.debugSpecialist) {
    console.log("[W4SQ][Specialist]", ...args);
  }
}

async function rollTotal(formula) {
  if (!formula || formula === "0") return { total: 0, formula: "0" };
  const roll = await (new Roll(formula).evaluate({}));
  return { total: roll.total, formula: roll.formula };
}

async function applyDelta(actor, key, delta, { min = 0, max = null } = {}) {
  if (!actor) return 0;
  const current = Number(actor.getFlag(FLAG_SCOPE, key) || 0);
  const targetMax = (max ?? Number(actor.getFlag(FLAG_SCOPE, `${key}Max`) || 0)) || null;
  let value = current + delta;
  if (targetMax !== null) value = Math.min(targetMax, value);
  value = Math.max(min, value);
  await actor.setFlag(FLAG_SCOPE, key, value);
  return value - current;
}

function formatMessage(key, data = {}) {
  if (game.i18n?.has?.(key)) {
    return game.i18n.format(key, data);
  }
  return key;
}

async function notify(actor, key, data = {}) {
  const speaker = ChatMessage.getSpeaker({ actor });
  const content = `<p>${formatMessage(key, data)}</p>`;
  await ChatMessage.create({ speaker, content });
}

function tokenCenter(token) {
  if (!token) return { x: 0, y: 0 };
  if (token.center) return token.center;
  return { x: token.x + (token.width ?? 0) / 2, y: token.y + (token.height ?? 0) / 2 };
}

function randomScenePoint(padding = 0) {
  const dims = canvas?.dimensions;
  if (!dims) return null;
  const size = dims.size ?? 100;
  const width = (dims.width ?? 0) * size;
  const height = (dims.height ?? 0) * size;
  const pad = Math.max(0, Number(padding) || 0);
  const spanX = Math.max(0, width - pad * 2);
  const spanY = Math.max(0, height - pad * 2);
  return {
    x: pad + Math.random() * (spanX || 0),
    y: pad + Math.random() * (spanY || 0)
  };
}

function firstActiveToken(actor) {
  return actor?.getActiveTokens?.(true)?.[0] ?? null;
}

function getTokenDisposition(token) {
  return token?.document?.disposition ?? null;
}

function isEnemyRelative(originDisposition, tokenDisposition) {
  if (originDisposition === null || originDisposition === undefined) {
    return tokenDisposition === CONST.TOKEN_DISPOSITIONS.HOSTILE;
  }
  return tokenDisposition !== originDisposition;
}

function isAllyRelative(originDisposition, tokenDisposition) {
  if (originDisposition === null || originDisposition === undefined) {
    return tokenDisposition !== CONST.TOKEN_DISPOSITIONS.HOSTILE;
  }
  return tokenDisposition === originDisposition;
}

function randomToken(tokens = []) {
  if (!tokens.length) return null;
  const index = Math.floor(Math.random() * tokens.length);
  return tokens[index] ?? null;
}

function randomTokenByRelation(actor, relation) {
  const placeables = canvas?.tokens?.placeables ?? [];
  if (!placeables.length) return null;
  const origin = firstActiveToken(actor);
  const originDisposition = getTokenDisposition(origin);
  const filtered = placeables.filter(token => {
    if (!token?.actor) return false;
    const disp = getTokenDisposition(token);
    if (relation === "enemy") return isEnemyRelative(originDisposition, disp);
    if (relation === "ally") return isAllyRelative(originDisposition, disp);
    return true;
  });
  if (!filtered.length && relation !== "any") {
    return randomTokenByRelation(actor, "any");
  }
  return randomToken(filtered.length ? filtered : placeables);
}

function sceneIdForToken(token) {
  return token?.document?.parent?.id ?? canvas.scene?.id;
}

const AOE_REPEAT_DATA = {
  firestorm: { type: "firestorm", duration: 3, data: { hpDamage: "4d20", moraleDamage: "6d20", movePerRound: 3 } },
  fireball: { type: "fireball", duration: 1, data: { hpDamage: "3d20", moraleDamage: "4d20" } }
};

let maneuversCache = null;
async function loadManeuvers() {
  if (maneuversCache) return maneuversCache;
  try {
    const module = await import("./maneuvers.js");
    maneuversCache = module?.MANEUVERS ?? null;
  } catch (err) {
    console.error("[W4SQ] Failed to load maneuvers for specialist perils", err);
    maneuversCache = null;
  }
  return maneuversCache;
}

function pickTokenForTargetType(actor, maneuver, { mode = "random" } = {}) {
  const targetType = maneuver?.target ?? "none";
  if (mode === "self") return firstActiveToken(actor);
  switch (targetType) {
    case "enemy":
      return randomTokenByRelation(actor, "enemy");
    case "ally":
      return randomTokenByRelation(actor, "ally");
    case "self":
      return firstActiveToken(actor);
    default:
      return null;
  }
}

async function handleAethyricEcho(actor, context = {}) {
  const key = context?.maneuverKey;
  if (!key) return;
  if (key in AOE_REPEAT_DATA) {
    const origin = firstActiveToken(actor);
    const config = AOE_REPEAT_DATA[key];
    const targetToken = key === "firestorm"
      ? (randomTokenByRelation(actor, "enemy") ?? randomTokenByRelation(actor, "any"))
      : randomTokenByRelation(actor, "enemy");
    const position = targetToken ? tokenCenter(targetToken) : randomScenePoint();
    await createAoEFromEffect({
      sceneId: sceneIdForToken(targetToken ?? origin),
      userId: game.user.id,
      casterTokenId: origin?.id ?? null,
      type: config.type,
      duration: config.duration,
      data: config.data,
      position
    });
    return;
  }

  const maneuvers = await loadManeuvers();
  const maneuver = maneuvers?.[key];
  if (!maneuver?.apply) return;
  const token = pickTokenForTargetType(actor, maneuver, { mode: "random" });
  const targetActor = token?.actor ?? (maneuver.target === "self" ? actor : null);
  if (maneuver.target && !targetActor && maneuver.target !== "none") return;
  await maneuver.apply({ actor, target: targetActor });
}

async function handleWarpMirror(actor, context = {}) {
  const key = context?.maneuverKey;
  if (!key) return;
  if (key in AOE_REPEAT_DATA) {
    const origin = firstActiveToken(actor);
    if (!origin) return;
    const config = AOE_REPEAT_DATA[key];
    await createAoEFromEffect({
      sceneId: sceneIdForToken(origin),
      userId: game.user.id,
      casterTokenId: origin.id,
      type: config.type,
      duration: config.duration,
      data: config.data,
      position: tokenCenter(origin)
    });
    return;
  }

  const maneuvers = await loadManeuvers();
  const maneuver = maneuvers?.[key];
  if (!maneuver?.apply) return;
  await maneuver.apply({ actor, target: actor });
}

export function getSpecialistType(actor) {
  const type = actor?.getFlag(FLAG_SCOPE, "specialistType") || null;
  if (type && SPECIALIST_TYPES[type]) return type;
  return null;
}

export function isSpecialist(actor) {
  return (actor?.getFlag(FLAG_SCOPE, "role") || "") === "specialist" && !!getSpecialistType(actor);
}

export function isMage(actor) {
  return isSpecialist(actor) && getSpecialistType(actor) === "mage";
}

export function isEngineer(actor) {
  return isSpecialist(actor) && getSpecialistType(actor) === "engineer";
}

export function specialistCooldown(actor) {
  const type = getSpecialistType(actor);
  if (!type) return 0;
  return SPECIALIST_TYPES[type]?.cooldown ?? 0;
}

export function hasChannelledMagic(actor) {
  return Boolean(actor?.getFlag(FLAG_SCOPE, "channelledMagic"));
}

export async function applyChannelledMagic(actor) {
  if (!actor) return;
  await clearChannelledMagic(actor);
  await actor.setFlag(FLAG_SCOPE, "channelledMagic", true);
  await addEffect(actor, {
    key: "channelled-magic",
    label: game.i18n.localize("W4SQ.EffectChannelledMagic"),
    duration: 99,
    mods: { tags: { channelledMagic: true } }
  });
  await notify(actor, "W4SQ.ChatChannelledMagic", { name: actor.name ?? "" });
}

export async function clearChannelledMagic(actor) {
  if (!actor) return;
  await actor.setFlag(FLAG_SCOPE, "channelledMagic", false);
  const effects = actor.getFlag(FLAG_SCOPE, "effects") ?? [];
  const filtered = effects.filter(effect => effect.key !== "channelled-magic");
  await actor.setFlag(FLAG_SCOPE, "effects", filtered);
}

const MINOR_PERILS = [
  async actor => {
    const roll = await rollTotal("2d10");
    await applyDelta(actor, "hp", -roll.total);
    await notify(actor, "W4SQ.PerilMinor1", { value: roll.total });
  },
  async actor => {
    const eq = Number(actor.getFlag(FLAG_SCOPE, "equipmentTier") || 0);
    const loss = eq * 5;
    await applyDelta(actor, "hp", -loss);
    await notify(actor, "W4SQ.PerilMinor2", { value: loss });
  },
  async actor => {
    const roll = await rollTotal("2d20");
    await ensureDisorganized(actor, { source: "peril" });
    await applyDelta(actor, "morale", -roll.total);
    await notify(actor, "W4SQ.PerilMinor3", { value: roll.total });
  },
  async actor => {
    const hp = await rollTotal("2d10");
    const mo = await rollTotal("3d10");
    await applyDelta(actor, "hp", -hp.total);
    await applyDelta(actor, "morale", -mo.total);
    await notify(actor, "W4SQ.PerilMinor4", { hp: hp.total, morale: mo.total });
  },
  async actor => {
    const roll = await rollTotal("2d10");
    await addEffect(actor, {
      key: "peril-mental-slip",
      label: game.i18n.localize("W4SQ.PerilMinor5Label"),
      duration: 1,
      mods: { tnDice: `-${roll.total}` }
    });
    await notify(actor, "W4SQ.PerilMinor5", { value: roll.total });
  },
  async actor => {
    const roll = await rollTotal("4d10");
    await applyDelta(actor, "morale", -roll.total);
    await notify(actor, "W4SQ.PerilMinor6", { value: roll.total });
  },
  async actor => {
    await actor.setFlag(FLAG_SCOPE, "noChannel", 1);
    await notify(actor, "W4SQ.PerilMinor7");
  },
  async actor => {
    const roll = await rollTotal("2d10");
    await notify(actor, "W4SQ.PerilMinor8", { value: roll.total });
    const allies = actor.getActiveTokens?.(true) ?? [];
    const allyToken = allies[1];
    if (allyToken?.actor) {
      await applyDelta(allyToken.actor, "hp", -roll.total);
    }
  },
  async actor => {
    await actor.setFlag(FLAG_SCOPE, "specialistEcho", true);
    await notify(actor, "W4SQ.PerilMinor9");
  },
  async actor => {
    await notify(actor, "W4SQ.PerilMinor10");
  }
];

const MAJOR_PERILS = [
  async (actor, { roll = 0, context = {} } = {}) => {
    const hp = await rollTotal("5d20");
    const morale = await rollTotal("7d20");
    await applyDelta(actor, "hp", -hp.total, { min: 0 });
    await applyDelta(actor, "morale", -morale.total, { min: 0 });
    await notify(actor, "W4SQ.PerilMajor1", { hp: hp.total, morale: morale.total });
  },
  async (actor, { roll = 0, context = {} } = {}) => {
    await notify(actor, "W4SQ.PerilMajor2");
  },
  async (actor, { roll = 0, context = {} } = {}) => {
    const perilRoll = await rollTotal("2d20");
    await applyDelta(actor, "morale", -perilRoll.total);
    await notify(actor, "W4SQ.PerilMajor3", { value: perilRoll.total });
  },
  async (actor, { roll = 0, context = {} } = {}) => {
    await notify(actor, "W4SQ.PerilMajor4");
  },
  async (actor, { roll = 0, context = {} } = {}) => {
    const perilRoll = await rollTotal("6d20");
    await applyDelta(actor, "hp", -perilRoll.total);
    await notify(actor, "W4SQ.PerilMajor5", { value: perilRoll.total });
  },
  async (actor, { roll = 0, context = {} } = {}) => {
    await notify(actor, "W4SQ.PerilMajor6");
    await handleAethyricEcho(actor, context);
  },
  async (actor, { roll = 0, context = {} } = {}) => {
    await notify(actor, "W4SQ.PerilMajor7");
  },
  async (actor, { roll = 0, context = {} } = {}) => {
    await notify(actor, "W4SQ.PerilMajor8");
    await handleWarpMirror(actor, context);
  },
  async (actor, { roll = 0, context = {} } = {}) => {
    await ensureDisorganized(actor, { source: "peril" });
    const perilRoll = await rollTotal("1d20");
    await applyDelta(actor, "morale", -perilRoll.total);
    await notify(actor, "W4SQ.PerilMajor9", { value: perilRoll.total });
  },
  async (actor, { roll = 0, context = {} } = {}) => {
    await notify(actor, "W4SQ.PerilMajor10");
  }
];

const ENGINEER_MISHAPS = [
  async actor => {
    await addEffect(actor, {
      key: `mishap-spent-${randomID()}`,
      label: game.i18n.localize("W4SQ.EffectSpentManeuver"),
      duration: 1,
      mods: { tags: { spentManeuver: true } }
    });
    await notify(actor, "W4SQ.Mishap1");
  },
  async actor => {
    const roll = await rollTotal("2d10");
    await applyDelta(actor, "hp", -roll.total);
    await notify(actor, "W4SQ.Mishap2", { value: roll.total });
  },
  async actor => {
    await notify(actor, "W4SQ.Mishap3");
  },
  async actor => {
    await ensureDisorganized(actor, { source: "mishap" });
    await notify(actor, "W4SQ.Mishap4");
  },
  async actor => {
    const current = Number(actor.getFlag(FLAG_SCOPE, "cooldownPenalty") || 0) + 1;
    await actor.setFlag(FLAG_SCOPE, "cooldownPenalty", current);
    await notify(actor, "W4SQ.Mishap5");
  },
  async actor => {
    await notify(actor, "W4SQ.Mishap6");
  },
  async actor => {
    const roll = await rollTotal("1d10");
    await notify(actor, "W4SQ.Mishap7", { value: roll.total });
  },
  async actor => {
    await addEffect(actor, {
      key: `mishap-delay-${randomID()}`,
      label: game.i18n.localize("W4SQ.EffectSpentManeuver"),
      duration: 1,
      mods: { tags: { spentManeuver: true } }
    });
    await notify(actor, "W4SQ.Mishap8");
  },
  async actor => {
    await notify(actor, "W4SQ.Mishap9");
  },
  async actor => {
    await actor.setFlag(FLAG_SCOPE, "engineerGenius", true);
    await notify(actor, "W4SQ.Mishap10");
  }
];

async function pickEntry(table) {
  const roll = await (new Roll("1d10").evaluate({}));
  const index = Math.min(table.length - 1, Math.max(0, roll.total - 1));
  return { entry: table[index], roll };
}

export async function triggerMinorPeril(actor) {
  if (!actor) return;
  const { entry, roll } = await pickEntry(MINOR_PERILS);
  logDebug("Minor Peril", actor.name, roll.total);
  await notify(actor, "W4SQ.PerilMinorRoll", { roll: roll.total });
  await entry(actor);
}

export async function triggerMajorPeril(actor, context = {}) {
  if (!actor) return;
  const { entry, roll } = await pickEntry(MAJOR_PERILS);
  logDebug("Major Peril", actor.name, roll.total, context);
  await notify(actor, "W4SQ.PerilMajorRoll", { roll: roll.total });
  await entry(actor, { roll: roll.total, context });
}

export async function triggerEngineerMishap(actor) {
  if (!actor) return;
  const { entry, roll } = await pickEntry(ENGINEER_MISHAPS);
  logDebug("Engineer Mishap", actor.name, roll.total);
  await notify(actor, "W4SQ.MishapRoll", { roll: roll.total });
  await entry(actor);
}

export async function consumeEngineerGenius(actor) {
  if (!actor) return false;
  const flag = actor.getFlag(FLAG_SCOPE, "engineerGenius");
  if (flag) {
    await actor.setFlag(FLAG_SCOPE, "engineerGenius", false);
    return true;
  }
  return false;
}

export async function consumeSpecialistEcho(actor) {
  if (!actor) return false;
  const flag = actor.getFlag(FLAG_SCOPE, "specialistEcho");
  if (flag) {
    await actor.setFlag(FLAG_SCOPE, "specialistEcho", false);
    return true;
  }
  return false;
}

export async function decrementNoChannel(actor) {
  if (!actor) return;
  const value = Number(actor.getFlag(FLAG_SCOPE, "noChannel") || 0);
  if (value > 0) {
    await actor.setFlag(FLAG_SCOPE, "noChannel", Math.max(0, value - 1));
  }
}

export function canChannel(actor) {
  const block = Number(actor?.getFlag(FLAG_SCOPE, "noChannel") || 0);
  return block <= 0;
}

export async function clearSpecialistRoundFlags(actor) {
  if (!actor) return;
  await decrementNoChannel(actor);
  await actor.unsetFlag(FLAG_SCOPE, "spentManeuver");
}
