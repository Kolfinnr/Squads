import { MODULE_ID, FLAG_SCOPE } from "./config.js";
import { addEffect, ensureEffect, removeEffectByKey, ensureDisorganized } from "./logic/effects.js";
import { adjustIncomingDamage, getOrigin, handleMoraleZero } from "./logic/origins.js";

const AOE_FLAG = "aoe";
const DEFAULT_DISTANCE = 4;
const ROUND_ONLY_TYPES = new Set(["firestorm", "fireball", "fortify", "lineDefense"]);
const ENTRY_TRIGGER_TYPES = new Set(["minefield", "wolfPits"]);

const DIRECTION_VECTORS = {
  N: { x: 0, y: -1 },
  NE: { x: 1, y: -1 },
  E: { x: 1, y: 0 },
  SE: { x: 1, y: 1 },
  S: { x: 0, y: 1 },
  SW: { x: -1, y: 1 },
  W: { x: -1, y: 0 },
  NW: { x: -1, y: -1 }
};

const AOE_DEFINITIONS = {
  firestorm: {
    template: { t: "circle", distance: 4 },
    duration: 3,
    roundOnly: true,
    labelKey: "W4SQ.AoEFirestorm"
  },
  fireball: {
    template: { t: "circle", distance: 3 },
    duration: 1,
    roundOnly: true,
    labelKey: "W4SQ.AoEFireball"
  },
  minefield: {
    template: { t: "circle", distance: 1.5 },
    duration: 4,
    triggerOnEntry: true,
    labelKey: "W4SQ.AoEMinefield"
  },
  wolfPits: {
    template: { t: "circle", distance: 1.5 },
    duration: 4,
    triggerOnEntry: true,
    labelKey: "W4SQ.AoEWolfPits"
  },
  fortify: {
    template: { t: "circle", distance: 3.5 },
    duration: null,
    roundOnly: true,
    labelKey: "W4SQ.AoEFortify"
  },
  lineDefense: {
    template: { t: "circle", distance: 1.5 },
    duration: 4,
    roundOnly: true,
    labelKey: "W4SQ.AoELineDefense"
  }
};

let hooksRegistered = false;

export function registerAoEHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  Hooks.on("combatRound", handleCombatRound);
  Hooks.on("updateCombat", handleUpdateCombat);
  Hooks.on("deleteMeasuredTemplate", handleTemplateDelete);
  Hooks.on("renderChatMessageHTML", activateAoEChatLink);
  Hooks.on("dropCanvasData", handleAoECanvasDrop);
}

export async function postAoEPlacementChat(actor, opts = {}, messageKey = "W4SQ.ChatAoEReady") {
  const payload = encodeURIComponent(JSON.stringify({
    type: "W4SQAoE",
    options: opts
  }));
  const label = game.i18n.localize(AOE_DEFINITIONS[opts.type]?.labelKey ?? "W4SQ.AoEUnknown");
  const prompt = game.i18n.format(messageKey, { name: actor?.name ?? "" });
  const linkText = game.i18n.format("W4SQ.ChatAoEDragLink", { aoe: label });
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${prompt}</p><p><a class="w4sq-aoe-drag" draggable="true" data-aoe-payload="${payload}"><i class="fas fa-bullseye"></i> ${linkText}</a></p>`
  });
}

function activateAoEChatLink(_message, html) {
  const root = html?.[0] ?? html;
  const links = [
    ...(root?.matches?.(".w4sq-aoe-drag") ? [root] : []),
    ...(root?.querySelectorAll?.(".w4sq-aoe-drag") ?? [])
  ];
  for (const link of links) {
    if (link.dataset.aoeDragReady === "true") continue;
    link.dataset.aoeDragReady = "true";
    link.addEventListener("dragstart", event => {
      const raw = link.dataset.aoePayload;
      if (!raw) return;
      const json = decodeURIComponent(raw);
      event.dataTransfer?.setData("text/plain", json);
      event.dataTransfer?.setData("application/json", json);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    });
  }
}

async function handleAoECanvasDrop(_canvas, data) {
  if (data?.type !== "W4SQAoE" || !data.options) return;
  const sceneId = canvas?.scene?.id;
  if (data.options.sceneId && data.options.sceneId !== sceneId) {
    ui.notifications?.warn?.(game.i18n.localize("W4SQ.ChatAoEWrongScene"));
    return false;
  }
  await createAoEFromEffect({
    ...data.options,
    sceneId,
    position: { x: Number(data.x) || 0, y: Number(data.y) || 0 }
  });
  return false;
}

export async function createAoEFromEffect(opts = {}) {
  const {
    sceneId = canvas?.scene?.id,
    userId = game.user.id,
    casterTokenId = null,
    type = "firestorm",
    duration,
    data = {},
    position = null
  } = opts;

  const definition = AOE_DEFINITIONS[type];
  if (!definition) {
    console.warn(`[W4SQ] Unknown AoE type: ${type}`);
    return null;
  }

  const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
  if (!scene) {
    console.warn("[W4SQ] Cannot create AoE without scene");
    return null;
  }

  const templateData = buildTemplateData(definition.template, {
    casterTokenId,
    type,
    duration: duration ?? definition.duration,
    data,
    userId,
    sceneId,
    position
  });
  templateData.flags ??= {};
  templateData.flags[MODULE_ID] ??= {};
  const state = templateData.flags[MODULE_ID][AOE_FLAG] ?? (templateData.flags[MODULE_ID][AOE_FLAG] = {});

  try {
    const created = await scene.createEmbeddedDocuments("MeasuredTemplate", [templateData]);
    const doc = created?.[0] ?? null;
    if (doc) {
      await finalizeTemplate(doc, state);
    }
    return doc;
  } catch (err) {
    console.error("[W4SQ] Failed to create AoE template", err);
    return null;
  }
}

function buildTemplateData(templateConfig = {}, { casterTokenId, type, duration, data, userId, sceneId, position } = {}) {
  const base = {
    t: templateConfig.t ?? "circle",
    user: userId,
    distance: templateConfig.distance ?? DEFAULT_DISTANCE,
    direction: 0,
    fillColor: game.user?.color ?? "#ff0000"
  };

  if (templateConfig.t === "rect") {
    base.distance = templateConfig.distance ?? 4;
    base.width = templateConfig.width ?? base.distance;
  }

  if (position) {
    base.x = position.x ?? 0;
    base.y = position.y ?? 0;
  } else {
    const caster = casterTokenId ? canvas?.tokens?.get(casterTokenId) : null;
    const center = caster?.center ?? caster?.document?.center ?? null;
    base.x = center?.x ?? 0;
    base.y = center?.y ?? 0;
  }

  const combat = game.combat;
  const placedRound = combat ? Number(combat.round ?? 0) : null;
  const placedTurn = combat ? Number(combat.turn ?? 0) : null;
  const armed = !ENTRY_TRIGGER_TYPES.has(type);

  const flagData = {
    aoeType: type,
    duration: duration ?? null,
    remaining: duration ?? null,
    data,
    casterTokenId,
    lastRound: type === "firestorm" ? placedRound : null,
    lastTurn: null,
    pendingFirstTick: false,
    occupants: [],
    direction: null,
    userId,
    sceneId,
    armed,
    placedRound,
    placedTurn
  };

  base.flags = base.flags ?? {};
  base.flags[MODULE_ID] = { [AOE_FLAG]: flagData };
  return base;
}

async function finalizeTemplate(templateDoc, state) {
  if (!templateDoc || !state) return;
  await templateDoc.setFlag(MODULE_ID, AOE_FLAG, {
    ...state,
    templateId: templateDoc.id
  });
}

async function handleCombatRound(combat) {
  if (!combat) return;
  await tickAoEZones(combat, { reason: "round" });
}

async function handleUpdateCombat(combat, changed) {
  if (!combat || !changed) return;
  const changedRound = Object.prototype.hasOwnProperty.call(changed, "round");
  const changedTurn = Object.prototype.hasOwnProperty.call(changed, "turn");
  if (changedRound || changedTurn) {
    await tickAoEZones(combat, { reason: changedRound ? "round" : "turn" });
  }
}

async function tickAoEZones(combat, context = {}) {
  if (!game.user.isGM) return;
  const scene = combat?.scene ?? canvas.scene;
  if (!scene || scene.id !== canvas.scene?.id) return;
  const round = Number(combat?.round ?? 0);
  const turn = Number(combat?.turn ?? 0);
  const templates = scene.templates.contents.filter(t => !!t.getFlag(MODULE_ID, AOE_FLAG));
  for (const template of templates) {
    await processTemplateTick(template, { combat, round, turn, context });
  }
}

async function processTemplateTick(templateDoc, { round, turn }) {
  const state = getAoEState(templateDoc);
  if (!state) return;
  const definition = AOE_DEFINITIONS[state.aoeType];
  if (!definition) return;
  if (ROUND_ONLY_TYPES.has(state.aoeType)) {
    if (state.lastRound === round) return;
  } else if (state.lastRound === round && state.lastTurn === turn) {
    return;
  }

  const template = getTemplateObject(templateDoc);
  const tokens = tokensInTemplate(templateDoc, template);

  if (ENTRY_TRIGGER_TYPES.has(state.aoeType)) {
    if (!isAoEArmed(state)) {
      if (shouldArmAoE(state, { round, turn })) {
        await armAoE(templateDoc, state);
      }
      if (!isAoEArmed(state)) {
        state.lastRound = round;
        state.lastTurn = turn;
        await templateDoc.setFlag(MODULE_ID, AOE_FLAG, state);
        return;
      }
    }

    if (!state.spent && tokens.length) {
      let removed = false;
      switch (state.aoeType) {
        case "minefield":
          await handleMinefieldTrigger(templateDoc, state, tokens);
          removed = true;
          break;
        case "wolfPits":
          await handleWolfPitsTrigger(templateDoc, state, tokens);
          removed = true;
          break;
        default:
          break;
      }
      if (removed) return;
    }

    state.lastRound = round;
    state.lastTurn = turn;
    await templateDoc.setFlag(MODULE_ID, AOE_FLAG, state);
    return;
  }

  let removed = false;
  switch (state.aoeType) {
    case "firestorm":
      removed = await handleFirestormTick(templateDoc, state, tokens, round);
      break;
    case "fireball":
      removed = await handleFireballTick(templateDoc, state, tokens, round);
      break;
    case "fortify":
      removed = await handleFortifyTick(templateDoc, state, tokens);
      break;
    case "lineDefense":
      removed = await handleLineDefenseTick(templateDoc, state, tokens);
      break;
    default:
      break;
  }
  if (removed) return;

  state.lastRound = round;
  state.lastTurn = turn;
  await templateDoc.setFlag(MODULE_ID, AOE_FLAG, state);
}

function isAoEArmed(state) {
  return state?.armed !== false;
}

function shouldArmAoE(state, source) {
  if (!state) return false;
  if (state.armed) return false;
  const round = Number(source?.round ?? game.combat?.round ?? 0);
  const turn = Number(source?.turn ?? game.combat?.turn ?? 0);
  const placedRound = state.placedRound;
  const placedTurn = state.placedTurn;
  if (placedRound == null || placedTurn == null) return true;
  if (round > placedRound) return true;
  if (round === placedRound && turn !== placedTurn) return true;
  return false;
}

async function armAoE(templateDoc, state) {
  state.armed = true;
  state.placedRound = Number(game.combat?.round ?? state.placedRound ?? 0);
  state.placedTurn = Number(game.combat?.turn ?? state.placedTurn ?? 0);
  await templateDoc.setFlag(MODULE_ID, AOE_FLAG, state);
}

function getAoEState(templateDoc) {
  return templateDoc.getFlag(MODULE_ID, AOE_FLAG);
}

function getTemplateObject(templateDoc) {
  const existing = canvas.templates.get(templateDoc.id);
  if (existing) return existing;
  const ObjectClass = CONFIG.MeasuredTemplate.objectClass;
  const object = new ObjectClass(templateDoc);
  object.position.set(templateDoc.x ?? 0, templateDoc.y ?? 0);
  return object;
}

function tokensInTemplate(templateDoc, templateObject) {
  if (!canvas?.tokens) return [];
  return canvas.tokens.placeables.filter(token => isTokenInside(templateDoc, token, templateObject));
}

function unitsToPixels(units) {
  const dimensions = canvas?.dimensions;
  if (!dimensions) return units;
  const size = dimensions.size ?? 100;
  const distance = dimensions.distance ?? 5;
  return (Number(units) || 0) * (size / distance);
}

function isTokenInside(templateDoc, token, templateObject) {
  if (!token?.center) return false;
  const { x, y } = token.center;

  if (templateObject?.shape?.contains && templateObject?.worldTransform) {
    const world = templateObject.worldTransform.applyInverse({ x, y });
    if (templateObject.shape.contains(world.x, world.y)) return true;
  }

  const type = templateDoc.t;
  if (type === "circle") {
    const radiusPx = unitsToPixels(templateDoc.distance ?? 0);
    const dx = x - (templateDoc.x ?? 0);
    const dy = y - (templateDoc.y ?? 0);
    return Math.hypot(dx, dy) <= radiusPx;
  }
  if (type === "rect") {
    const widthPx = unitsToPixels(templateDoc.distance ?? 0) / 2;
    const heightPx = unitsToPixels(templateDoc.width ?? templateDoc.distance ?? 0) / 2;
    const cx = templateDoc.x ?? 0;
    const cy = templateDoc.y ?? 0;
    return Math.abs(x - cx) <= widthPx && Math.abs(y - cy) <= heightPx;
  }
  return false;
}

async function handleFirestormTick(templateDoc, state, tokens, round) {
  if (state.pendingFirstTick) {
    state.pendingFirstTick = false;
    return false;
  }
  await applyDamageToTokens(tokens, state.data?.hpDamage ?? "4d20", state.data?.moraleDamage ?? "6d20", {
    state,
    template: templateDoc
  });
  await moveFirestorm(templateDoc, state);
  decrementRemaining(state);
  if (state.remaining !== null && state.remaining <= 0) {
    await templateDoc.delete();
    return true;
  }
  return false;
}

async function moveFirestorm(templateDoc, state) {
  const moveCells = Number(state.data?.movePerRound ?? 3);
  if (!moveCells || !canvas?.scene) return;
  if (!state.direction) {
    const dirs = Object.keys(DIRECTION_VECTORS);
    const index = Math.floor(Math.random() * dirs.length);
    state.direction = dirs[index];
  }
  const vector = DIRECTION_VECTORS[state.direction] ?? DIRECTION_VECTORS.N;
  const delta = unitsToPixels(moveCells);
  const newX = (templateDoc.x ?? 0) + vector.x * delta;
  const newY = (templateDoc.y ?? 0) + vector.y * delta;
  const dims = canvas.dimensions;
  if (newX < 0 || newY < 0 || newX > dims.width * dims.size || newY > dims.height * dims.size) {
    await templateDoc.delete();
    return;
  }
  await templateDoc.update({ x: newX, y: newY });
}

async function handleFireballTick(templateDoc, state, tokens) {
  await applyDamageToTokens(tokens, state.data?.hpDamage ?? "3d20", state.data?.moraleDamage ?? "4d20", {
    state,
    template: templateDoc
  });
  await templateDoc.delete();
  return true;
}

async function handleFortifyTick(templateDoc, state, tokens) {
  const casterDisposition = getCasterDisposition(state.casterTokenId);
  const occupantIds = new Set();
  for (const token of tokens) {
    const actor = token.actor;
    if (!actor) continue;
    if (casterDisposition != null && token.document.disposition !== casterDisposition) continue;
    const effectKey = `fortify-${templateDoc.id}`;
    await ensureEffect(actor, {
      key: effectKey,
      label: game.i18n.localize("W4SQ.EffectFortifyZone"),
      duration: 99,
      mods: {
        defSoakDice: "+10 + 2d10",
        tags: { fortified: true }
      }
    }, eff => eff.key === effectKey);
    occupantIds.add(actor.id);
    if (state.casterTokenId && token.id === state.casterTokenId) {
      const deepKey = `fortify-deep-${templateDoc.id}`;
      await ensureEffect(actor, {
        key: deepKey,
        label: game.i18n.localize("W4SQ.EffectDeepDefense"),
        duration: 99,
        mods: {
          defSoakDice: "+20 + 2d20",
          tags: { deepDefense: true }
        }
      }, eff => eff.key === deepKey);
      occupantIds.add(`${actor.id}-deep`);
    }
  }
  await clearDepartedOccupants(state, occupantIds, templateDoc.id);
  if (state.duration && state.duration > 0) {
    decrementRemaining(state);
    if (state.remaining !== null && state.remaining <= 0) {
      await templateDoc.delete();
      return true;
    }
  }
  return false;
}

async function handleLineDefenseTick(templateDoc, state, tokens) {
  const casterDisposition = getCasterDisposition(state.casterTokenId);
  const occupantIds = new Set();

  const remaining = Number.isFinite(Number(state.remaining))
    ? Number(state.remaining)
    : Number(state.duration ?? 0);

  if (!Number.isFinite(remaining) || remaining <= 0) {
    await templateDoc.delete();
    return true;
  }

  const effectDuration = Math.max(1, remaining - 1);

  for (const token of tokens) {
    const actor = token.actor;
    if (!actor) continue;
    if (casterDisposition != null && token.document.disposition !== casterDisposition) continue;

    const effectKey = `line-defense-${templateDoc.id}`;
    await removeEffectByKey(actor, effectKey);
    await addEffect(actor, {
      key: effectKey,
      label: game.i18n.localize("W4SQ.EffectLineDefense"),
      duration: effectDuration,
      mods: {
        defSoakDice: "+2d10",
        tags: { braced: true, fortified: true }
      }
    });
    occupantIds.add(actor.id);
  }

  await clearDepartedOccupants(state, occupantIds, templateDoc.id);

  decrementRemaining(state);
  if (state.remaining !== null && state.remaining <= 0) {
    await templateDoc.delete();
    return true;
  }
  return false;
}

async function handleMinefieldTrigger(templateDoc, state, tokens) {
  await applyDamageToTokens(tokens, state.data?.hpDamage ?? "3d20", state.data?.moraleDamage ?? "4d20", {
    state,
    template: templateDoc
  });
  for (const entry of tokens) {
    const actor = entry.actor;
    if (!actor) continue;
    await ensureDisorganized(actor, { source: "minefield" });
  }
  state.spent = true;
  await templateDoc.delete();
}

async function handleWolfPitsTrigger(templateDoc, state, tokens) {
  await applyDamageToTokens(tokens, state.data?.hpDamage ?? "2d10", state.data?.moraleDamage ?? "2d10", {
    state,
    template: templateDoc
  });
  for (const entry of tokens) {
    const actor = entry.actor;
    if (!actor) continue;
    await addEffect(actor, {
      key: `wolf-pits-${templateDoc.id}`,
      label: game.i18n.localize("W4SQ.EffectWolfPits"),
      duration: 1,
      mods: { tags: { skipTurn: true } }
    });
  }
  state.spent = true;
  await templateDoc.delete();
}

async function applyDamageToTokens(tokens, hpFormula, moraleFormula, context = {}) {
  const affectedEnemies = [];
  for (const token of tokens) {
    const actor = token.actor;
    if (!actor) continue;
    let hpTotal = 0;
    let moraleTotal = 0;
    let resistanceBlocked = 0;
    let inflicted = false;
    if (hpFormula) {
      const hpRoll = await rollFormula(hpFormula);
      hpTotal = hpRoll.total;
      const adjusted = await adjustIncomingDamage(actor, null, {
        damage: hpTotal,
        moraleBonus: 0,
        damageType: "aoe",
        isMagical: Boolean(context?.state?.data?.magical),
        isAoE: true
      });
      hpTotal = adjusted.damage;
      resistanceBlocked = adjusted.resistanceBlocked ?? 0;
      if (hpTotal > 0) inflicted = true;
      await adjustActorFlag(actor, "hp", -hpTotal, "hpMax");
    }
    if (moraleFormula) {
      const moraleRoll = await rollFormula(moraleFormula);
      moraleTotal = moraleRoll.total;
      if (moraleTotal > 0) inflicted = true;
      const result = await adjustActorFlag(actor, "morale", -moraleTotal, "moraleMax");
      const moraleMax = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 0);
      if (getOrigin(actor) !== "undead" && moraleMax > 0 && result.after / moraleMax < 0.5) {
        await ensureDisorganized(actor, { source: "morale" });
      }
      if (result.before > 0 && result.after <= 0) {
        if (getOrigin(actor) === "undead") {
          await handleMoraleZero(actor, null);
        } else {
          await ensureEffect(actor, {
            key: `routed-zone-${crypto.randomUUID?.() ?? randomID()}`,
            label: game.i18n.localize("W4SQ.EffectRouted"),
            duration: 99,
            mods: { tags: { routed: true, disorganized: true } }
          }, eff => eff?.mods?.tags?.routed);
        }
      }
    }
    if (inflicted) {
      affectedEnemies.push({ token, hpTotal, moraleTotal, resistanceBlocked });
    }
  }
  if (affectedEnemies.length) {
    await sendAoEFlavorMessage(affectedEnemies, context);
  }
}

async function adjustActorFlag(actor, key, delta, maxKey) {
  const current = Number(actor.getFlag(FLAG_SCOPE, key) || 0);
  const max = maxKey ? Number(actor.getFlag(FLAG_SCOPE, maxKey) || 0) || null : null;
  let next = current + delta;
  if (max !== null) next = Math.min(max, next);
  next = Math.max(0, next);
  await actor.setFlag(FLAG_SCOPE, key, next);
  return { before: current, after: next };
}

async function clearDepartedOccupants(state, occupantIds, templateId) {
  const previous = Array.isArray(state.occupants) ? state.occupants : [];
  for (const actorId of previous) {
    if (occupantIds.has(actorId)) continue;
    const actor = game.actors.get(actorId);
    if (!actor) continue;
    await removeEffectByKey(actor, `fortify-${templateId}`);
    await removeEffectByKey(actor, `fortify-deep-${templateId}`);
    await removeEffectByKey(actor, `line-defense-${templateId}`);
  }
  state.occupants = [...occupantIds].filter(id => typeof id === "string" && !id.includes("-deep"));
}

async function handleTemplateDelete(templateDoc) {
  const state = getAoEState(templateDoc);
  if (!state) return;
  const occupants = Array.isArray(state.occupants) ? state.occupants : [];
  for (const actorId of occupants) {
    const actor = game.actors.get(actorId);
    if (!actor) continue;
    await removeEffectByKey(actor, `fortify-${templateDoc.id}`);
    await removeEffectByKey(actor, `line-defense-${templateDoc.id}`);
    await removeEffectByKey(actor, `wolf-pits-${templateDoc.id}`);
  }
  if (state.casterTokenId) {
    const token = canvas.tokens.get(state.casterTokenId);
    const actor = token?.actor;
    if (actor) {
      await removeEffectByKey(actor, `fortify-deep-${templateDoc.id}`);
    }
  }
}

function decrementRemaining(state) {
  if (state.remaining === null || state.remaining === undefined) return;
  state.remaining = Math.max(0, Number(state.remaining) - 1);
}

async function rollFormula(formula) {
  if (!formula || formula === "0") return { total: 0 };
  const roll = await (new Roll(formula)).evaluate({});
  return roll;
}

function getCasterDisposition(tokenId) {
  if (!tokenId) return null;
  const token = canvas.tokens.get(tokenId);
  return token?.document?.disposition ?? null;
}

const AOE_FLAVOR_KEYS = {
  firestorm: { single: "W4SQ.ChatAoEFirestormSingle", multi: "W4SQ.ChatAoEFirestormMulti" },
  fireball: { single: "W4SQ.ChatAoEFireballSingle", multi: "W4SQ.ChatAoEFireballMulti" },
  minefield: { single: "W4SQ.ChatAoEMinefieldSingle", multi: "W4SQ.ChatAoEMinefieldMulti" },
  wolfPits: { single: "W4SQ.ChatAoEWolfPitsSingle", multi: "W4SQ.ChatAoEWolfPitsMulti" }
};

const DEFAULT_AOE_FLAVOR = { single: "W4SQ.ChatAoEHitSingle", multi: "W4SQ.ChatAoEHits" };

async function sendAoEFlavorMessage(entries, context = {}) {
  const state = context.state;
  if (!state) return;
  const definition = AOE_DEFINITIONS[state.aoeType];
  const labelKey = definition?.labelKey ?? "W4SQ.AoEUnknown";
  const aoeLabel = game.i18n?.localize?.(labelKey) ?? state.aoeType ?? "AoE";

  const casterToken = state.casterTokenId ? canvas?.tokens?.get(state.casterTokenId) : null;
  const casterActor = casterToken?.actor ?? null;
  const casterDisposition = casterToken?.document?.disposition ?? null;

  const seen = new Set();
  const enemyNames = [];
  for (const entry of entries) {
    const token = entry?.token;
    if (!token) continue;
    const disposition = token.document?.disposition ?? null;
    let isEnemy = true;
    if (casterDisposition !== null && casterDisposition !== undefined) {
      isEnemy = disposition !== casterDisposition;
    } else if (disposition !== CONST.TOKEN_DISPOSITIONS.HOSTILE) {
      isEnemy = false;
    }
    if (!isEnemy) continue;
    const name = token.name ?? token.document?.name;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    enemyNames.push(name);
  }

  if (!enemyNames.length) return;

  const totals = entries.reduce((acc, entry) => {
    acc.hp += Number(entry?.hpTotal ?? 0);
    acc.morale += Number(entry?.moraleTotal ?? 0);
    return acc;
  }, { hp: 0, morale: 0 });

  const keySet = AOE_FLAVOR_KEYS[state.aoeType] ?? DEFAULT_AOE_FLAVOR;
  const single = enemyNames.length === 1;
  const key = single ? keySet.single : keySet.multi;
  const firstEntry = entries[0] ?? {};
  const hpValue = single ? Number(firstEntry.hpTotal ?? 0) : totals.hp;
  const moraleValue = single ? Number(firstEntry.moraleTotal ?? 0) : totals.morale;
  const damageValue = hpValue + moraleValue;

  const message = game.i18n?.format?.(key, {
    aoe: aoeLabel,
    target: enemyNames[0],
    targets: formatNameList(enemyNames),
    hp: hpValue,
    morale: moraleValue,
    damage: damageValue
  }) ?? `${aoeLabel} batters ${formatNameList(enemyNames)}`;
  const blocked = entries.reduce((sum, entry) => sum + Number(entry?.resistanceBlocked ?? 0), 0);
  const resistanceNote = blocked > 0
    ? `<p>${game.i18n.format("W4SQ.ChatNonMagicalResistance", { total: blocked })}</p>`
    : "";

  const speakerActor = casterActor ?? entries[0]?.token?.actor ?? null;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: speakerActor }),
    content: `<p>${message}</p>${resistanceNote}`
  });
}

function formatNameList(names = []) {
  const unique = [...names];
  if (unique.length <= 1) return unique[0] ?? "";
  if (unique.length === 2) return `${unique[0]} ${game.i18n?.localize?.("W4SQ.WordAnd") ?? "and"} ${unique[1]}`;
  const last = unique.pop();
  return `${unique.join(", ")}, ${game.i18n?.localize?.("W4SQ.WordAnd") ?? "and"} ${last}`;
}
