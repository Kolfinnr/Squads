import { MODULE_ID, FLAG_SCOPE } from "../config.js";
import { ensureEffect, ensureDisorganized } from "./effects.js";

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

function buildTemplateData(templateConfig = {}, originToken = null) {
  const defaults = { type: "rect", widthSquares: 1, heightSquares: 1 };
  const config = foundry.utils.mergeObject(defaults, templateConfig ?? {}, { inplace: false });
  const size = gridSize();
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
    const radiusSquares = config.size ?? config.radius ?? 1;
    data.distance = radiusSquares * gridDistance();
  } else {
    const widthSquares = config.widthSquares ?? config.size ?? 1;
    const heightSquares = config.heightSquares ?? config.size ?? 1;
    data.width = widthSquares * size;
    data.height = heightSquares * size;
  }
  return data;
}

async function previewTemplate(document, { originToken } = {}) {
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
  if (typeof MeasuredTemplate?.createPreview === "function") {
    try {
      return await new Promise(resolve => {
        MeasuredTemplate.createPreview({
          document,
          user: game.user,
          callback: result => {
            if (result?.document) return resolve(result.document);
            resolve(result ?? null);
          }
        });
      });
    } catch (err) {
      console.error(`${MODULE_ID} | MeasuredTemplate.createPreview failed`, err);
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

const ZONE_HANDLERS = {
  firestorm: {
    duration: 3,
    template: { type: "rect", widthSquares: 2, heightSquares: 2 },
    target: "any",
    async onEnter({ actor, document, zone }) {
      const duration = zone.duration ?? 1;
      const key = `zone-firestorm-${document.id}-${actor.id}`;
      const label = game.i18n.localize("W4SQ.ManeuverFirestorm");
      await ensureEffect(actor, {
        key,
        label,
        duration,
        mods: { tags: { zoneFirestorm: true, [`zone-${document.id}`]: true } }
      }, effect => effect.key === key);
    }
  },
  lineDefense: {
    duration: 3,
    template: { type: "rect", widthSquares: 2, heightSquares: 1 },
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
    template: { type: "rect", widthSquares: 2, heightSquares: 2 },
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
    template: { type: "rect", widthSquares: 2, heightSquares: 2 },
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
    duration: 3,
    template: { type: "rect", widthSquares: 3, heightSquares: 3 },
    target: "allies",
    async onEnter({ actor, document, zone }) {
      const duration = zone.duration ?? 1;
      const key = `zone-fortify-${document.id}-${actor.id}`;
      await ensureEffect(actor, {
        key,
        label: game.i18n.localize("W4SQ.ManeuverFortify"),
        duration,
        mods: { defSoakDice: "+3d10", tags: { fortified: true, braced: true } }
      }, effect => effect.key === key);
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
    extra: options.extra ?? {}
  };
  templateData.flags = templateData.flags ?? {};
  templateData.flags[MODULE_ID] = { [FLAG_KEY]: zoneData };
  const DocumentClass = CONFIG.MeasuredTemplate.documentClass;
  const document = new DocumentClass(templateData, { parent: canvas.scene });
  const placed = await previewTemplate(document, { originToken });
  return placed ?? null;
}

export async function handleZoneTemplateCreated(document) {
  if (!document) return;
  const zone = getZoneData(document);
  if (!zone) return;
  const handler = getZoneHandler(zone.key);
  if (!handler) return;
  const tokens = tokensInTemplate(document, handler);
  await applyZone(document, handler, tokens);
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
    if (!tokenMatchesTarget(zone, handler, token)) continue;
    const shape = template.shape;
    if (!shape?.contains) continue;
    const local = worldToLocal(template, tokenCenter(token));
    if (!shape.contains(local.x, local.y)) continue;
    await handler.onEnter?.({
      actor: token.actor,
      token,
      document: template.document,
      zone,
      sourceActor: zone.actorId ? game.actors?.get(zone.actorId) ?? null : null
    });
  }
}

export async function handleZoneTokenCreated(tokenDoc) {
  await handleZoneTokenMove(tokenDoc, { x: tokenDoc.x, y: tokenDoc.y });
}

export function getZoneHandlers() {
  return ZONE_HANDLERS;
}
