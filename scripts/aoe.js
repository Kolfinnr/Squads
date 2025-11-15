import { MODULE_ID, FLAG_SCOPE } from "./config.js";
import { addEffect, ensureEffect, removeEffectByKey, ensureDisorganized } from "./logic/effects.js";

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
    roundOnly: true
  },
  fireball: {
    template: { t: "circle", distance: 3 },
    duration: 1,
    roundOnly: true
  },
  minefield: {
    template: { t: "circle", distance: 1.5 },
    duration: 4,
    triggerOnEntry: true
  },
  wolfPits: {
    template: { t: "circle", distance: 1.5 },
    duration: 4,
    triggerOnEntry: true
  },
  fortify: {
    template: { t: "circle", distance: 3.5 },
    duration: null,
    roundOnly: true
  },
  lineDefense: {
    template: { t: "rect", distance: 5, width: 4.5 },
    duration: 3,
    roundOnly: true
  }
};

let hooksRegistered = false;

export function registerAoEHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  Hooks.on("combatRound", handleCombatRound);
  Hooks.on("updateCombat", handleUpdateCombat);
  Hooks.on("updateToken", handleTokenMove);
  Hooks.on("createToken", handleTokenMove);
  Hooks.on("deleteMeasuredTemplate", handleTemplateDelete);
}

export async function createAoEFromEffect(opts = {}) {
  const {
    sceneId = canvas?.scene?.id,
    userId = game.user.id,
    casterTokenId = null,
    type = "firestorm",
    duration,
    data = {},
    skipPreview = false,
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

  if (!skipPreview) {
    if (!canvas?.scene) {
      ui.notifications?.warn?.("No active scene to place this AoE.");
      return null;
    }
    if (canvas.scene.id !== scene.id) {
      ui.notifications?.warn?.("Switch to the caster's scene to place this AoE.");
      return null;
    }

    const previewId =
      globalThis.foundry?.utils?.randomID?.() ??
      (typeof randomID === "function" ? randomID() : Math.random().toString(36).slice(2));
    templateData.flags[MODULE_ID][AOE_FLAG].previewId = previewId;

    const startResult = startAoEPreview(templateData, async doc => {
      await finalizeTemplate(doc, { ...state, previewId });
    });

    if (startResult !== false) {
      return startResult;
    }
  }

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

  const flagData = {
    aoeType: type,
    duration: duration ?? null,
    remaining: duration ?? null,
    data,
    casterTokenId,
    lastRound: null,
    lastTurn: null,
    pendingFirstTick: type === "firestorm",
    occupants: [],
    direction: null,
    userId,
    sceneId
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

function startAoEPreview(templateData, finalize) {
  const previewId = templateData?.flags?.[MODULE_ID]?.[AOE_FLAG]?.previewId;
  const registerHook = () => {
    const hookId = Hooks.on("createMeasuredTemplate", doc => {
      const docState = doc?.getFlag(MODULE_ID, AOE_FLAG);
      if (!docState || docState.previewId !== previewId) return;
      Hooks.off("createMeasuredTemplate", hookId);
      Promise.resolve(finalize?.(doc)).catch(err => console.error("[W4SQ] AoE finalize failed", err));
    });
    return hookId;
  };

  if (game.measuredTemplate?.createPreview) {
    const hookId = registerHook();
    try {
      const preview = game.measuredTemplate.createPreview({ templateData, user: game.user, scene: canvas.scene });
      if (typeof preview?.once === "function") {
        preview.once("destroy", () => Hooks.off("createMeasuredTemplate", hookId));
      }
      return preview ?? true;
    } catch (err) {
      Hooks.off("createMeasuredTemplate", hookId);
      console.error("[W4SQ] Failed to start AoE preview", err);
    }
  }

  if (canvas?.templates?.activatePreview) {
    const hookId = registerHook();
    try {
      const preview = canvas.templates.activatePreview(templateData);
      if (typeof preview?.once === "function") {
        preview.once("destroy", () => Hooks.off("createMeasuredTemplate", hookId));
      }
      return preview ?? true;
    } catch (err) {
      Hooks.off("createMeasuredTemplate", hookId);
      console.error("[W4SQ] Failed to start legacy AoE preview", err);
    }
  }

  if (canvas?.scene) {
    const doc = new MeasuredTemplateDocument(templateData, { parent: canvas.scene });
    const preview = new SquadAoEPreview(doc, finalize);
    preview.draw();
    preview.activatePreviewListeners();
    return preview;
  }

  ui.notifications?.warn?.("Cannot start AoE preview on this client/version.");
  return false;
}

class SquadAoEPreview extends MeasuredTemplate {
  constructor(document, finalize) {
    super(document);
    this._finalize = finalize;
  }

  async _onLeftClick(event) {
    event.stopPropagation();
    try {
      const created = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [this.document.toObject()]);
      const doc = created?.[0];
      if (doc) await this._finalize?.(doc);
    } catch (err) {
      console.error("[W4SQ] AoE preview finalize failed", err);
    } finally {
      this.destroy();
    }
  }

  _onRightClick(event) {
    event.stopPropagation();
    this.destroy();
  }
}

async function handleCombatRound(combat) {
  if (!combat) return;
  await tickAoEZones(combat, { reason: "round" });
}

async function handleUpdateCombat(combat, changed) {
  if (!combat || !changed) return;
  if (Object.prototype.hasOwnProperty.call(changed, "round")) {
    await tickAoEZones(combat, { reason: "round" });
  }
}

async function handleTokenMove(tokenDoc) {
  if (!canvas?.scene) return;
  if (tokenDoc?.parent?.id !== canvas.scene.id) return;
  const token = canvas.tokens.get(tokenDoc.id);
  if (!token) return;
  const templates = canvas.scene.templates.contents.filter(t => !!t.getFlag(MODULE_ID, AOE_FLAG));
  for (const template of templates) {
    const state = getAoEState(template);
    if (!state) continue;
    if (!ENTRY_TRIGGER_TYPES.has(state.aoeType)) continue;
    if (state.spent) continue;
    if (isTokenInside(template, token)) {
      await processEntryTrigger(template, state, token);
    }
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
  if (templateObject?.shape?.contains) {
    const world = templateObject.worldTransform.applyInverse({ x, y });
    return templateObject.shape.contains(world.x, world.y);
  }
  return false;
}

async function handleFirestormTick(templateDoc, state, tokens, round) {
  if (state.pendingFirstTick) {
    state.pendingFirstTick = false;
    return false;
  }
  await applyDamageToTokens(tokens, state.data?.hpDamage ?? "4d20", state.data?.moraleDamage ?? "6d20");
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
  await applyDamageToTokens(tokens, state.data?.hpDamage ?? "3d20", state.data?.moraleDamage ?? "4d20");
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
      duration: 2,
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
        duration: 2,
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
  for (const token of tokens) {
    const actor = token.actor;
    if (!actor) continue;
    if (casterDisposition != null && token.document.disposition !== casterDisposition) continue;
    const effectKey = `line-defense-${templateDoc.id}`;
    await ensureEffect(actor, {
      key: effectKey,
      label: game.i18n.localize("W4SQ.EffectLineDefense"),
      duration: 2,
      mods: {
        defSoakDice: "+2d10",
        tags: { braced: true, fortified: true }
      }
    }, eff => eff.key === effectKey);
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

async function processEntryTrigger(templateDoc, state, token) {
  switch (state.aoeType) {
    case "minefield":
      await handleMinefieldTrigger(templateDoc, state, token);
      break;
    case "wolfPits":
      await handleWolfPitsTrigger(templateDoc, state, token);
      break;
    default:
      break;
  }
}

async function handleMinefieldTrigger(templateDoc, state, token) {
  const tokens = tokensInTemplate(templateDoc, getTemplateObject(templateDoc));
  await applyDamageToTokens(tokens, state.data?.hpDamage ?? "3d20", state.data?.moraleDamage ?? "4d20");
  for (const entry of tokens) {
    const actor = entry.actor;
    if (!actor) continue;
    await ensureDisorganized(actor, { source: "minefield" });
  }
  state.spent = true;
  await templateDoc.delete();
}

async function handleWolfPitsTrigger(templateDoc, state, token) {
  const tokens = tokensInTemplate(templateDoc, getTemplateObject(templateDoc));
  await applyDamageToTokens(tokens, state.data?.hpDamage ?? "2d10", state.data?.moraleDamage ?? "2d10");
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

async function applyDamageToTokens(tokens, hpFormula, moraleFormula) {
  for (const token of tokens) {
    const actor = token.actor;
    if (!actor) continue;
    if (hpFormula) {
      const hpRoll = await rollFormula(hpFormula);
      await adjustActorFlag(actor, "hp", -hpRoll.total, "hpMax");
    }
    if (moraleFormula) {
      const moraleRoll = await rollFormula(moraleFormula);
      const result = await adjustActorFlag(actor, "morale", -moraleRoll.total, "moraleMax");
      const moraleMax = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 0);
      if (moraleMax > 0 && result.after / moraleMax < 0.5) {
        await ensureDisorganized(actor, { source: "morale" });
      }
      if (result.before > 0 && result.after <= 0) {
        await ensureEffect(actor, {
          key: `routed-zone-${crypto.randomUUID?.() ?? randomID()}`,
          label: game.i18n.localize("W4SQ.EffectRouted"),
          duration: 99,
          mods: { tags: { routed: true, disorganized: true } }
        }, eff => eff?.mods?.tags?.routed);
      }
    }
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
  const roll = await (new Roll(formula)).roll({ async: true });
  return roll;
}

function getCasterDisposition(tokenId) {
  if (!tokenId) return null;
  const token = canvas.tokens.get(tokenId);
  return token?.document?.disposition ?? null;
}
