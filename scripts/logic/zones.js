import { MODULE_ID, FLAG_SCOPE } from "../config.js";
import { ensureEffect, ensureDisorganized, addEffect, removeEffectByKey } from "./effects.js";

const FLAG_KEY = "zone";

function getOriginToken(actor) {
  const tokens = actor?.getActiveTokens?.(true) ?? [];
  return tokens[0] ?? null;
}

function gridSize() {
  return canvas?.grid?.size ?? 100;
}

function gridDistance() {
  return canvas?.dimensions?.distance ?? canvas?.grid?.distance ?? 5;
}

function sceneBounds() {
  const dims = canvas?.dimensions;
  if (dims) {
    const size = dims.size ?? gridSize();
    const width = dims.sceneWidth ?? ((dims.width ?? 0) * size);
    const height = dims.sceneHeight ?? ((dims.height ?? 0) * size);
    const x = dims.sceneX ?? 0;
    const y = dims.sceneY ?? 0;
    return { x, y, width, height };
  }
  const grid = gridSize();
  const scene = canvas?.scene;
  const width = (scene?.width ?? 0) * grid;
  const height = (scene?.height ?? 0) * grid;
  return { x: 0, y: 0, width, height };
}

function buildTemplateData(templateConfig = {}, originToken = null) {
  const defaults = { type: "rect" };
  const config = foundry.utils.mergeObject(defaults, templateConfig ?? {}, { inplace: false });
  const unitDistance = gridDistance() || 1;
  const originX = originToken ? (originToken.center?.x ?? (originToken.x + originToken.width / 2)) : 0;
  const originY = originToken ? (originToken.center?.y ?? (originToken.y + originToken.height / 2)) : 0;
  const data = {
    t: config.type ?? "rect",
    user: game.user.id,
    fillColor: config.fillColor ?? game.user.color,
    angle: config.angle ?? 0,
    direction: config.direction ?? 0,
    x: originX,
    y: originY
  };

  if (data.t === "circle") {
    if (config.radiusUnits != null) {
      data.distance = Number(config.radiusUnits);
    } else if (config.distance != null) {
      data.distance = Number(config.distance);
    } else if (config.radius != null) {
      data.distance = Number(config.radius) * unitDistance;
    } else if (config.size != null) {
      data.distance = Number(config.size) * unitDistance;
    } else {
      data.distance = unitDistance;
    }
  } else {
    const fallback = Number(config.size ?? 1) || 1;
    const widthUnits = config.widthUnits != null
      ? Number(config.widthUnits)
      : config.widthSquares != null
        ? Number(config.widthSquares) * unitDistance
        : fallback * unitDistance;
    const heightUnits = config.heightUnits != null
      ? Number(config.heightUnits)
      : config.heightSquares != null
        ? Number(config.heightSquares) * unitDistance
        : fallback * unitDistance;
    data.distance = widthUnits || unitDistance;
    data.width = heightUnits || unitDistance;
  }

  return data;
}

async function previewTemplate(document, { originToken } = {}) {
  if (typeof MeasuredTemplate?.createPreview === "function") {
    try {
      const preview = await MeasuredTemplate.createPreview({ document, user: game.user });
      if (preview?.document) return preview.document;
      return preview ?? null;
    } catch (err) {
      console.error(`${MODULE_ID} | MeasuredTemplate.createPreview failed`, err);
    }
  }
  if (canvas?.templates?.preview?.create) {
    try {
      return await new Promise(resolve => {
        canvas.templates.preview.create({
          document,
          user: game.user,
          callback: result => {
            if (result?.document) return resolve(result.document);
            resolve(result ?? null);
          }
        });
      });
    } catch (err) {
      console.error(`${MODULE_ID} | Template preview failed`, err);
    }
  }
  const data = document.toObject();
  if (originToken) {
    data.x = originToken.center?.x ?? originToken.x + originToken.width / 2;
    data.y = originToken.center?.y ?? originToken.y + originToken.height / 2;
  }
  const created = await canvas.scene?.createEmbeddedDocuments("MeasuredTemplate", [data]);
  return created?.[0] ?? null;
}

async function adjustFlag(actor, key, delta, maxKey = null) {
  if (!actor) return { before: 0, after: 0, delta: 0 };
  const before = Number(actor.getFlag(FLAG_SCOPE, key) || 0);
  let after = before + delta;
  if (maxKey) {
    const max = Number(actor.getFlag(FLAG_SCOPE, maxKey) || 0) || 0;
    after = Math.min(max, after);
  }
  after = Math.max(0, after);
  await actor.setFlag(FLAG_SCOPE, key, after);
  return { before, after, delta: after - before };
}

async function postZoneChat(actor, key, data = {}) {
  const content = `<p>${game.i18n?.format?.(key, data) ?? key}</p>`;
  await ChatMessage.create({
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : {},
    content
  });
}

function escapeName(actor) {
  const raw = actor?.name ?? game.i18n.localize("W4SQ.UnknownSquad");
  if (typeof TextEditor?.escapeHTML === "function") return TextEditor.escapeHTML(raw);
  return raw;
}

async function postDefeatLine(actor, key) {
  if (!actor) return;
  const name = escapeName(actor);
  const template = game.i18n?.has?.(key)
    ? game.i18n.format(key, { name })
    : `<strong>${name}</strong>`;
  const content = `<p>${template}</p>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });
}

async function rollAndApplyDamage(actor, { hpFormula = null, moraleFormula = null } = {}) {
  if (!actor) return { hp: 0, morale: 0 };
  let hp = 0;
  let morale = 0;
  let moraleBefore = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
  let moraleMax = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 0);
  const hpBefore = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
  if (hpFormula) {
    const roll = await (new Roll(hpFormula).roll({ async: true }));
    hp = roll.total;
    const result = await adjustFlag(actor, "hp", -hp, "hpMax");
    const hpAfter = result.after;
    if (hpBefore > 0 && hpAfter <= 0) {
      await postDefeatLine(actor, "W4SQ.ChatHPZero");
    }
  }
  if (moraleFormula) {
    const roll = await (new Roll(moraleFormula).roll({ async: true }));
    morale = roll.total;
    const result = await adjustFlag(actor, "morale", -morale, "moraleMax");
    const moraleAfter = result.after;
    moraleBefore = result.before;
    moraleMax = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 0);
    if (moraleBefore > 0 && moraleAfter <= 0) {
      await ensureEffect(actor, {
        key: "routed",
        label: game.i18n.localize("W4SQ.EffectRouted"),
        duration: 99,
        mods: { tags: { routed: true, disorganized: true } }
      }, effect => Boolean(effect?.mods?.tags?.routed));
      await postDefeatLine(actor, "W4SQ.ChatMoraleZero");
    } else if (moraleMax > 0 && moraleAfter / moraleMax < 0.5) {
      await ensureDisorganized(actor, { source: "morale" });
    }
  }
  return { hp, morale };
}

const DIRECTIONS = [
  { dx: 0, dy: -1, label: "N" },
  { dx: 1, dy: -1, label: "NE" },
  { dx: 1, dy: 0, label: "E" },
  { dx: 1, dy: 1, label: "SE" },
  { dx: 0, dy: 1, label: "S" },
  { dx: -1, dy: 1, label: "SW" },
  { dx: -1, dy: 0, label: "W" },
  { dx: -1, dy: -1, label: "NW" }
];

function deepDefenseKey(document, actor) {
  return `zone-fortify-deep-${document.id}-${actor.id}`;
}

async function applyFortifyBuffs({ actor, document, zone }) {
  if (!actor) return;
  const baseKey = `zone-fortify-${document.id}-${actor.id}`;
  const activeDuration = Math.max(1, Number(zone?.duration ?? 1));
  await removeEffectByKey(actor, baseKey);
  await addEffect(actor, {
    key: baseKey,
    label: game.i18n.localize("W4SQ.ManeuverFortify"),
    duration: activeDuration,
    mods: { defSoakDice: "+3d10", tags: { fortified: true, braced: true } }
  });

  if (zone?.actorId && actor.id === zone.actorId) {
    const key = deepDefenseKey(document, actor);
    await removeEffectByKey(actor, key);
    await addEffect(actor, {
      key,
      label: game.i18n.localize("W4SQ.EffectDeepDefense"),
      duration: activeDuration,
      mods: { defSoakDice: "+1d20", tags: { deepDefense: true } }
    });
  } else {
    await removeEffectByKey(actor, deepDefenseKey(document, actor));
  }
}

const ZONE_HANDLERS = {
  firestorm: {
    duration: 3,
    template: { type: "circle", radiusUnits: 3 },
    target: "any",
    moveSquares: 2,
    async onEnter({ actor, document, zone, sourceActor }) {
      const duration = zone.duration ?? 1;
      const key = `zone-firestorm-${document.id}-${actor.id}`;
      const label = game.i18n.localize("W4SQ.ManeuverFirestorm");
      await ensureEffect(actor, {
        key,
        label,
        duration,
        mods: { tags: { zoneFirestorm: true, [`zone-${document.id}`]: true } }
      }, effect => effect.key === key);
      const damage = await rollAndApplyDamage(actor, { hpFormula: "4d20", moraleFormula: "6d20" });
      const caster = sourceActor ?? (zone.actorId ? game.actors.get(zone.actorId) ?? null : null) ?? actor;
      await postZoneChat(caster, "W4SQ.ChatFirestorm", {
        name: caster.name ?? game.i18n.localize("W4SQ.UnknownSquad"),
        target: actor.name ?? game.i18n.localize("W4SQ.UnknownSquad"),
        hp: damage.hp,
        morale: damage.morale
      });
    },
    async onRound({ actor, zone, sourceActor }) {
      const damage = await rollAndApplyDamage(actor, { hpFormula: "4d20", moraleFormula: "6d20" });
      await postZoneChat(sourceActor ?? actor, "W4SQ.ChatFirestormPulse", {
        name: actor.name ?? game.i18n.localize("W4SQ.UnknownSquad"),
        hp: damage.hp,
        morale: damage.morale
      });
    }
  },
  lineDefense: {
    duration: 3,
    template: { type: "circle", radiusUnits: 1.5 },
    target: "allies",
    async onEnter({ actor, document, zone }) {
      const duration = zone.duration ?? 1;
      const key = `zone-line-defense-${document.id}-${actor.id}`;
      await ensureEffect(actor, {
        key,
        label: game.i18n.localize("W4SQ.ManeuverLineDefense"),
        duration,
        mods: { defSoakDice: "+2d10", tags: { braced: true, fortified: true } }
      }, effect => effect.key === key);
    }
  },
  minefield: {
    duration: 3,
    template: { type: "circle", radiusUnits: 1.5 },
    target: "enemies",
    singleUse: true,
    async onEnter({ actor, document, zone, sourceActor }) {
      if (zone.triggered) return;
      const hpRoll = await (new Roll("3d20").roll({ async: true }));
      const moraleRoll = await (new Roll("4d20").roll({ async: true }));
      await adjustFlag(actor, "hp", -hpRoll.total, "hpMax");
      await adjustFlag(actor, "morale", -moraleRoll.total, "moraleMax");
      await ensureDisorganized(actor, { source: "zone" });
      await postZoneChat(sourceActor ?? actor, "W4SQ.ChatMinefield", {
        name: sourceActor?.name ?? game.i18n.localize("W4SQ.UnknownSquad"),
        target: actor.name ?? game.i18n.localize("W4SQ.UnknownSquad"),
        hp: hpRoll.total,
        morale: moraleRoll.total
      });
      const updated = { ...zone, triggered: true };
      await document.setFlag(MODULE_ID, FLAG_KEY, updated);
      await document.delete();
    }
  },
  wolfPits: {
    duration: 3,
    template: { type: "circle", radiusUnits: 1.5 },
    target: "enemies",
    singleUse: true,
    async onEnter({ actor, document, zone, sourceActor }) {
      if (zone.triggered) return;
      const hpRoll = await (new Roll("2d10").roll({ async: true }));
      const moraleRoll = await (new Roll("2d10").roll({ async: true }));
      await adjustFlag(actor, "hp", -hpRoll.total, "hpMax");
      await adjustFlag(actor, "morale", -moraleRoll.total, "moraleMax");
      await ensureEffect(actor, {
        key: `zone-wolf-pits-${document.id}-${actor.id}`,
        label: game.i18n.localize("W4SQ.ManeuverWolfPits"),
        duration: 1,
        mods: { tags: { skipTurn: true } }
      }, effect => effect.key === `zone-wolf-pits-${document.id}-${actor.id}`);
      await postZoneChat(sourceActor ?? actor, "W4SQ.ChatWolfPits", {
        name: sourceActor?.name ?? game.i18n.localize("W4SQ.UnknownSquad"),
        target: actor.name ?? game.i18n.localize("W4SQ.UnknownSquad"),
        hp: hpRoll.total,
        morale: moraleRoll.total
      });
      const updated = { ...zone, triggered: true };
      await document.setFlag(MODULE_ID, FLAG_KEY, updated);
      await document.delete();
    }
  },
  fortifyPosition: {
    duration: 99,
    template: { type: "rect", widthUnits: 5, heightUnits: 4.5 },
    target: "allies",
    async onEnter({ actor, document, zone }) {
      await applyFortifyBuffs({ actor, document, zone });
    },
    async onRound({ actor, document, zone }) {
      await applyFortifyBuffs({ actor, document, zone });
    },
    async onExit({ actor, document }) {
      if (!actor) return;
      const baseKey = `zone-fortify-${document.id}-${actor.id}`;
      await removeEffectByKey(actor, baseKey);
      await removeEffectByKey(actor, deepDefenseKey(document, actor));
    }
  }
};

function getZoneHandler(zoneKey) {
  return ZONE_HANDLERS[zoneKey] ?? null;
}

function getZoneData(document) {
  return document?.getFlag(MODULE_ID, FLAG_KEY) ?? null;
}

function getTemplateObject(document) {
  if (!document) return null;
  return canvas?.templates?.placeables?.find(t => t.document?.id === document.id) ?? null;
}

function worldToLocal(template, point) {
  const pt = new PIXI.Point(point.x, point.y);
  if (template?.worldTransform?.applyInverse) {
    return template.worldTransform.applyInverse(pt, pt);
  }
  return new PIXI.Point(pt.x - template.x, pt.y - template.y);
}

function tokenCenter(token) {
  if (!token) return { x: 0, y: 0 };
  if (token.center) return token.center;
  return { x: token.x + token.width / 2, y: token.y + token.height / 2 };
}

function tokenMatchesTarget(zone, handler, token) {
  const target = zone.target ?? handler.target ?? "any";
  if (target === "any") return true;
  const originDisposition = zone.disposition ?? null;
  const tokenDisposition = token?.document?.disposition ?? null;
  if (originDisposition === null || tokenDisposition === null) return true;
  if (target === "allies") return tokenDisposition === originDisposition;
  if (target === "enemies") return tokenDisposition !== originDisposition;
  return true;
}

function tokensInTemplate(document, handler) {
  const template = getTemplateObject(document);
  if (!template) return [];
  const shape = template.shape;
  if (!shape?.contains) return [];
  const tokens = canvas?.tokens?.placeables ?? [];
  return tokens.filter(token => {
    const zone = getZoneData(document);
    if (!tokenMatchesTarget(zone ?? {}, handler, token)) return false;
    const center = tokenCenter(token);
    const local = worldToLocal(template, center);
    return shape.contains(local.x, local.y);
  });
}

function normalizeOccupants(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map(entry => {
      if (!entry) return null;
      if (typeof entry === "string") {
        return { tokenId: entry, actorId: null };
      }
      const tokenId = entry.tokenId ?? entry.id ?? entry.token ?? null;
      if (!tokenId) return null;
      const actorId = entry.actorId ?? entry.actor ?? null;
      return { tokenId, actorId: actorId ?? null };
    })
    .filter(Boolean);
}

function recordsFromTokens(tokens) {
  return tokens
    .filter(Boolean)
    .map(token => ({ tokenId: token.id, actorId: token.actor?.id ?? null }));
}

function recordsEqual(a, b) {
  if (foundry?.utils?.deepEquals) {
    return foundry.utils.deepEquals(a, b);
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to compare zone occupant lists`, err);
    return false;
  }
}

async function applyZone(document, handler, tokens) {
  const zone = getZoneData(document);
  if (!zone || !handler?.onEnter) return;
  const sourceActor = zone.actorId ? game.actors?.get(zone.actorId) ?? null : null;
  for (const token of tokens) {
    const actor = token?.actor;
    if (!actor) continue;
    await handler.onEnter({ actor, token, document, zone, sourceActor });
  }
}

async function syncZoneOccupants(document, handler, tokens) {
  const zone = getZoneData(document);
  if (!zone) return { entered: [], exited: [] };
  const previous = normalizeOccupants(zone.occupants);
  const prevMap = new Map(previous.map(rec => [rec.tokenId, rec]));
  const currentRecords = recordsFromTokens(tokens);
  const currentMap = new Map(currentRecords.map(rec => [rec.tokenId, rec]));

  const enteredTokens = tokens.filter(token => !prevMap.has(token.id));
  const exitedRecords = previous.filter(rec => !currentMap.has(rec.tokenId));

  if (enteredTokens.length) {
    await applyZone(document, handler, enteredTokens);
  }

  if (exitedRecords.length && typeof handler.onExit === "function") {
    const sourceActor = zone.actorId ? game.actors?.get(zone.actorId) ?? null : null;
    for (const record of exitedRecords) {
      const token = canvas?.tokens?.get(record.tokenId) ?? null;
      const actor = token?.actor ?? (record.actorId ? game.actors?.get(record.actorId) ?? null : null);
      if (!actor) continue;
      try {
        await handler.onExit({ actor, token, document, zone, sourceActor });
      } catch (err) {
        console.error(`${MODULE_ID} | Zone onExit failed`, err);
      }
    }
  }

  if (!recordsEqual(previous, currentRecords)) {
    const flagKey = `flags.${MODULE_ID}.${FLAG_KEY}`;
    const updated = foundry.utils.mergeObject(zone, { occupants: currentRecords }, { inplace: false });
    try {
      document._w4sqSkipEnter = true;
      await document.update({ [flagKey]: updated }, { diff: false, recursive: false });
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to update zone occupants`, err);
    } finally {
      document._w4sqSkipEnter = false;
    }
  }

  return { entered: enteredTokens, exited: exitedRecords };
}

function randomDirection() {
  const idx = Math.floor(Math.random() * DIRECTIONS.length);
  return DIRECTIONS[idx] ?? DIRECTIONS[0];
}

function squareDistance(squares = 1) {
  const size = gridSize();
  return squares * size;
}

function moveUpdate(document, handler) {
  const squares = handler.moveSquares ?? 0;
  if (!squares) return {};
  const dir = randomDirection();
  const dist = squareDistance(squares);
  const dx = dir.dx * dist;
  const dy = dir.dy * dist;
  if (!dx && !dy) return {};
  const x = (document.x ?? 0) + dx;
  const y = (document.y ?? 0) + dy;
  return { x, y };
}

async function handleRoundEffects(document, handler, zone, tokensOverride) {
  if (!handler?.onRound) return;
  const tokens = tokensOverride ?? tokensInTemplate(document, handler);
  const sourceActor = zone.actorId ? game.actors?.get(zone.actorId) ?? null : null;
  for (const token of tokens) {
    const actor = token?.actor;
    if (!actor) continue;
    await handler.onRound({ actor, token, document, zone, sourceActor });
  }
}

export function randomScenePoint(padding = 0) {
  const bounds = sceneBounds();
  if (!bounds.width || !bounds.height) return null;
  const pad = Math.max(0, Number(padding) || 0);
  const width = Math.max(0, bounds.width - pad * 2);
  const height = Math.max(0, bounds.height - pad * 2);
  const x = bounds.x + pad + Math.random() * (width || 0);
  const y = bounds.y + pad + Math.random() * (height || 0);
  return { x, y };
}

export async function requestZonePlacement(actor, zoneKey, options = {}) {
  const handler = getZoneHandler(zoneKey);
  if (!handler) {
    console.warn(`${MODULE_ID} | Unknown zone key`, zoneKey);
    return null;
  }
  if (!canvas?.scene) {
    ui.notifications?.warn?.("No active scene for template placement.");
    return null;
  }
  const originToken = getOriginToken(actor);
  if (actor?.sheet?.rendered) {
    try {
      await actor.sheet.close();
    } catch (err) {
      console.warn(`${MODULE_ID} | Failed to close sheet before zone placement`, err);
    }
  }
  const templateData = buildTemplateData(options.template ?? handler.template, originToken);
  const zoneData = {
    key: zoneKey,
    duration: options.duration ?? handler.duration ?? 1,
    actorId: actor?.id ?? null,
    tokenId: originToken?.id ?? null,
    disposition: originToken?.document?.disposition ?? null,
    target: options.target ?? handler.target ?? "any",
    extra: options.extra ?? {},
    occupants: []
  };
  templateData.flags = templateData.flags ?? {};
  templateData.flags[MODULE_ID] = { [FLAG_KEY]: zoneData };
  const DocumentClass = CONFIG.MeasuredTemplate.documentClass;
  const document = new DocumentClass(templateData, { parent: canvas.scene });
  const placed = await previewTemplate(document, { originToken });
  return placed ?? null;
}

export async function spawnZone(actor, zoneKey, options = {}) {
  const handler = getZoneHandler(zoneKey);
  if (!handler) {
    console.warn(`${MODULE_ID} | Unknown zone key`, zoneKey);
    return null;
  }
  if (!canvas?.scene) {
    console.warn(`${MODULE_ID} | No scene to spawn zone ${zoneKey}`);
    return null;
  }
  const originToken = options.originToken ?? getOriginToken(actor);
  const templateData = buildTemplateData(options.template ?? handler.template, originToken);
  if (options.position) {
    templateData.x = options.position.x ?? templateData.x;
    templateData.y = options.position.y ?? templateData.y;
  }
  const zoneData = {
    key: zoneKey,
    duration: options.duration ?? handler.duration ?? 1,
    actorId: actor?.id ?? null,
    tokenId: options.tokenId ?? originToken?.id ?? null,
    disposition: options.disposition ?? originToken?.document?.disposition ?? null,
    target: options.target ?? handler.target ?? "any",
    extra: options.extra ?? {},
    occupants: []
  };
  templateData.flags = templateData.flags ?? {};
  templateData.flags[MODULE_ID] = { [FLAG_KEY]: zoneData };
  try {
    const created = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [templateData]);
    return created?.[0] ?? null;
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to spawn zone ${zoneKey}`, err);
    return null;
  }
}

export async function handleZoneTemplateCreated(document) {
  if (!document) return;
  if (document._w4sqSkipEnter) {
    document._w4sqSkipEnter = false;
    return;
  }
  const zone = getZoneData(document);
  if (!zone) return;
  const handler = getZoneHandler(zone.key);
  if (!handler) return;
  const tokens = tokensInTemplate(document, handler);
  await syncZoneOccupants(document, handler, tokens);
}

export async function handleZoneTokenMove(tokenDoc, changes) {
  if (!tokenDoc) return;
  if (changes && !("x" in changes) && !("y" in changes)) return;
  const token = canvas?.tokens?.get(tokenDoc.id);
  if (!token) return;
  const templates = canvas?.templates?.placeables ?? [];
  for (const template of templates) {
    const zone = getZoneData(template.document);
    if (!zone) continue;
    const handler = getZoneHandler(zone.key);
    if (!handler) continue;
    const tokens = tokensInTemplate(template.document, handler);
    await syncZoneOccupants(template.document, handler, tokens);
  }
}

export async function handleZoneTokenCreated(tokenDoc) {
  await handleZoneTokenMove(tokenDoc, { x: tokenDoc.x, y: tokenDoc.y });
}

export function getZoneHandlers() {
  return ZONE_HANDLERS;
}

export async function tickZones({ isRoundStart = false } = {}) {
  if (!canvas?.scene) return;
  const templates = canvas.templates?.placeables ?? [];
  for (const template of templates) {
    const document = template?.document;
    const zone = getZoneData(document);
    if (!zone) continue;
    const handler = getZoneHandler(zone.key);
    if (!handler) continue;
    if (handler.singleUse && zone.triggered) {
      await document.delete();
      continue;
    }

    if (isRoundStart) {
      const move = moveUpdate(document, handler);
      if (Object.keys(move).length > 0) {
        try {
          document._w4sqSkipEnter = true;
          await document.update(move);
        } catch (err) {
          console.error(`${MODULE_ID} | Failed to reposition zone`, err);
        } finally {
          document._w4sqSkipEnter = false;
        }
      }
    }

    let tokens = tokensInTemplate(document, handler);
    await syncZoneOccupants(document, handler, tokens);
    const zoneState = getZoneData(document);
    if (!zoneState) continue;
    if (handler.singleUse && zoneState.triggered) {
      await document.delete();
      continue;
    }

    tokens = tokensInTemplate(document, handler);
    try {
      await handleRoundEffects(document, handler, zoneState, tokens);
    } catch (err) {
      console.error(`${MODULE_ID} | Zone round effect failed`, err);
    }

    if (!isRoundStart) continue;

    const currentDuration = Number(zoneState.duration ?? handler.duration ?? 0);
    const nextDuration = currentDuration > 0 ? currentDuration - 1 : 0;
    if (nextDuration <= 0) {
      try {
        await syncZoneOccupants(document, handler, []);
      } catch (err) {
        console.error(`${MODULE_ID} | Failed to flush zone occupants`, err);
      }
      try {
        await document.delete();
      } catch (err) {
        console.error(`${MODULE_ID} | Failed to delete expired zone`, err);
      }
      continue;
    }

    const flagKey = `flags.${MODULE_ID}.${FLAG_KEY}`;
    const updatedState = { ...zoneState, duration: nextDuration };
    try {
      document._w4sqSkipEnter = true;
      await document.update({ [flagKey]: updatedState });
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to update zone duration`, err);
    } finally {
      document._w4sqSkipEnter = false;
    }
  }
}
