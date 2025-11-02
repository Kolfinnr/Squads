import { FLAG_SCOPE, SETTINGS, MODULE_ID, ACTOR_TYPES } from "../config.js";
import { addEffect, getEffects, effectPolarity } from "./effects.js";
import { buildHoBDatabase } from "./hob-db.js";

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isSquadActor(actor) {
  return actor && ACTOR_TYPES.includes(actor.type) && actor.getFlag(FLAG_SCOPE, "hp") !== undefined;
}

function sceneTokens() {
  return canvas?.tokens?.placeables ?? [];
}

function tokenDisposition(token) {
  return token?.document?.disposition ?? token?.disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;
}

function actorDisposition(actor) {
  const active = actor?.getActiveTokens?.(true) ?? [];
  if (active.length) {
    return tokenDisposition(active[0]);
  }
  for (const token of sceneTokens()) {
    if (token?.actor === actor) return tokenDisposition(token);
  }
  return CONST.TOKEN_DISPOSITIONS.NEUTRAL;
}

function alliedSquadActors(actor, { includeSelf = true } = {}) {
  const disposition = actorDisposition(actor);
  const set = new Set();
  for (const token of sceneTokens()) {
    const squad = token?.actor;
    if (!isSquadActor(squad)) continue;
    if (tokenDisposition(token) !== disposition) continue;
    if (!includeSelf && squad === actor) continue;
    set.add(squad);
  }
  if (includeSelf && isSquadActor(actor)) {
    set.add(actor);
  }
  return [...set];
}

function randomActor(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const idx = Math.floor(Math.random() * list.length);
  return list[idx] ?? null;
}

let hobDatabase = null;

function getHoBDatabase() {
  if (!hobDatabase) {
    hobDatabase = buildHoBDatabase({
      rollFormula,
      adjustMorale,
      adjustHP,
      addEffect,
      removeDisorganized,
      removeTired,
      removeFirstNegative,
      removePositiveEffects,
      alliedSquadActors,
      randomActor,
      buildDetail,
      immediateFromRoll,
      setActorFlag: (actor, key, value) => actor.setFlag(FLAG_SCOPE, key, value),
      getActorFlag: (actor, key) => actor.getFlag(FLAG_SCOPE, key)
    });
  }
  return hobDatabase;
}

function getHoBTable(key) {
  const db = getHoBDatabase();
  const table = db?.[key];
  return Array.isArray(table) ? table : [];
}

async function removeEffectsByPredicate(actor, predicate) {
  const list = getEffects(actor);
  const filtered = list.filter(effect => !predicate(effect));
  if (filtered.length === list.length) return false;
  await actor.setFlag(FLAG_SCOPE, "effects", filtered);
  return true;
}

async function removeTagged(actor, tag) {
  return removeEffectsByPredicate(actor, eff => eff?.mods?.tags?.[tag]);
}

async function removeFirstNegative(actor) {
  const list = getEffects(actor);
  const index = list.findIndex(effect => effectPolarity(effect) === "negative");
  if (index === -1) return false;
  list.splice(index, 1);
  await actor.setFlag(FLAG_SCOPE, "effects", list);
  return true;
}

async function removePositiveEffects(actor) {
  return removeEffectsByPredicate(actor, effect => effectPolarity(effect) === "positive");
}

async function removeDisorganized(actor) {
  return removeTagged(actor, "disorganized");
}

async function removeTired(actor) {
  return removeTagged(actor, "tired");
}

async function rollFormula(formula) {
  return (await new Roll(formula).roll({ async: true }));
}

function immediateFromRoll(roll) {
  return { total: roll.total, formula: roll.formula };
}

async function adjustResource(actor, key, delta, { min = 0, maxFlag } = {}) {
  const current = Number(actor.getFlag(FLAG_SCOPE, key) || 0);
  let next = current + delta;
  if (maxFlag) {
    const cap = Number(actor.getFlag(FLAG_SCOPE, maxFlag) || 0);
    if (Number.isFinite(cap) && cap > 0) {
      next = Math.min(cap, next);
    }
  }
  if (min !== undefined && min !== null) {
    next = Math.max(min, next);
  }
  await actor.setFlag(FLAG_SCOPE, key, next);
  return next - current;
}

async function adjustHP(actor, delta) {
  return adjustResource(actor, "hp", delta, { min: 0, maxFlag: "hpMax" });
}

async function adjustMorale(actor, delta) {
  return adjustResource(actor, "morale", delta, { min: 0, maxFlag: "moraleMax" });
}

function buildDetail(summary, { tn = [], damage = [] } = {}) {
  return {
    summary: summary ?? null,
    immediate: {
      tn,
      damage
    }
  };
}

function ensureImmediate(value) {
  if (!value) return null;
  if (typeof value === "number") {
    return { total: value, formula: "" };
  }
  if (typeof value === "object") {
    const total = Number(value.total ?? value.value ?? value.amount ?? NaN);
    if (!Number.isFinite(total)) return null;
    const formula = value.formula ?? value.dice ?? value.roll ?? "";
    return { total, formula };
  }
  return null;
}

function normalizeDetail(detail) {
  if (!detail) {
    return buildDetail(null);
  }
  if (typeof detail === "string") {
    return buildDetail(detail);
  }
  const summary = detail.summary ?? null;
  const immediate = detail.immediate ?? {};
  return {
    summary,
    immediate: {
      tn: toArray(immediate.tn).map(ensureImmediate).filter(Boolean),
      damage: toArray(immediate.damage).map(ensureImmediate).filter(Boolean)
    }
  };
}

function describeImmediate(immediate = {}) {
  const tnAdjustments = toArray(immediate.tn);
  const damageAdjustments = toArray(immediate.damage);
  const strings = [];

  for (const item of tnAdjustments) {
    strings.push(game.i18n.format("W4SQ.ChatHoBTn", { total: item.total, formula: item.formula || "" }));
  }
  for (const item of damageAdjustments) {
    strings.push(game.i18n.format("W4SQ.ChatHoBDamage", { total: item.total, formula: item.formula || "" }));
  }

  return { strings, tnAdjustments, damageAdjustments };
}

async function resolveEvent(actor, poolKey, heading, context = {}, meta = {}) {
  const table = getHoBTable(poolKey);
  if (!table.length) return null;

  const roll = await rollFormula("1d10");
  const rollValue = Math.max(1, Math.min(10, Math.floor(roll.total)));
  const entry = table[rollValue - 1] ?? table[table.length - 1];
  if (!entry) return null;

  const trigger = meta.trigger ?? poolKey;
  const rawResult = await entry.apply?.(actor, { ...context, rollValue, rollResult: roll, trigger, pool: poolKey });
  const detailSource = rawResult && typeof rawResult === "object" && Object.prototype.hasOwnProperty.call(rawResult, "detail")
    ? rawResult.detail
    : rawResult;
  const detail = normalizeDetail(detailSource);
  const immediateDesc = describeImmediate(detail.immediate);

  const extras = [];
  if (detail.summary) extras.push(detail.summary);
  if (immediateDesc.strings.length) {
    extras.push(game.i18n.format("W4SQ.ChatHoBImmediate", { effects: immediateDesc.strings.join(", ") }));
  }
  const extraText = extras.length ? `<br/><em>${extras.join("<br/>")}</em>` : "";
  const content = `<h3>${heading} (d10: ${roll.total})</h3><p><strong>${entry.title}</strong> – ${entry.text}${extraText}</p>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });

  return {
    heading,
    title: entry.title,
    summary: detail.summary,
    immediateStrings: immediateDesc.strings,
    immediate: {
      tn: immediateDesc.tnAdjustments,
      damage: immediateDesc.damageAdjustments
    },
    damageMultiplier: Number(rawResult?.damageMultiplier ?? 1) || 1,
    roll: rollValue,
    pool: poolKey,
    trigger
  };
}


export async function maybeTriggerHoB(actor, { roll, success, type, target } = {}) {
  if (!game.settings.get(MODULE_ID, SETTINGS.enableHoB)) return null;
  const results = [];
  const context = { type, target };

  const isDouble = roll >= 11 && roll <= 99 && roll % 11 === 0;
  const triggers = [];
  if (isDouble) {
    const successPool = success ? "good" : "bad";
    const heading = success ? game.i18n.localize("W4SQ.HoBGood") : game.i18n.localize("W4SQ.HoBBad");
    triggers.push({ pool: successPool, heading, trigger: success ? "criticalSuccess" : "criticalFailure" });
  }

  const hp = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
  const hpMax = Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 0);
  const morale = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
  const moraleMax = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 0);

  if (hpMax > 0 && hp / hpMax <= 0.3 && !actor.getFlag(FLAG_SCOPE, "hob_hp30")) {
    await actor.setFlag(FLAG_SCOPE, "hob_hp30", true);
    const heading = game.i18n.localize("W4SQ.HoBLowHP");
    triggers.push({ pool: "hp", heading, trigger: "lowHp", threshold: "hp" });
  }

  if (moraleMax > 0 && morale / moraleMax <= 0.3 && !actor.getFlag(FLAG_SCOPE, "hob_mo30")) {
    await actor.setFlag(FLAG_SCOPE, "hob_mo30", true);
    const heading = game.i18n.localize("W4SQ.HoBLowMorale");
    triggers.push({ pool: "morale", heading, trigger: "lowMorale", threshold: "morale" });
  }

  for (const trig of triggers) {
    const event = await resolveEvent(actor, trig.pool, trig.heading, { ...context, threshold: trig.threshold ?? null }, { trigger: trig.trigger });
    if (event) results.push(event);
  }

  if (!results.length) return null;

  const notes = [];
  const tnAdjustments = [];
  const damageAdjustments = [];
  let damageMultiplier = 1;

  for (const event of results) {
    const label = game.i18n.format("W4SQ.ChatHoBSummary", { heading: event.heading, title: event.title });
    const parts = [];
    if (event.summary) parts.push(event.summary);
    if (event.immediateStrings?.length) {
      parts.push(game.i18n.format("W4SQ.ChatHoBImmediate", { effects: event.immediateStrings.join(", ") }));
    }
    notes.push({ title: label, detail: parts.join(" — ") });
    tnAdjustments.push(...(event.immediate?.tn ?? []));
    damageAdjustments.push(...(event.immediate?.damage ?? []));
    damageMultiplier *= Number(event.damageMultiplier || 1) || 1;
  }

  return { notes, tnAdjustments, damageAdjustments, damageMultiplier };
}
