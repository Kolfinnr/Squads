import { MODULE_ID, FLAG_SCOPE } from "../config.js";
import { ensureEffect, ensureDisorganized, addEffect, removeEffectByKey } from "./effects.js";
import { adjustIncomingDamage, adjustMoraleLoss, getOrigin, handleMoraleZero } from "./origins.js";

const FLAG_KEY = "zone";

function gridSize() {
  return canvas?.grid?.size ?? 100;
}

function gridDistance() {
  return canvas?.dimensions?.distance ?? canvas?.grid?.distance ?? 5;
}

function duplicateConfig(source = {}) {
  const data = source || {};
  if (globalThis?.foundry?.utils?.duplicate) {
    try {
      return foundry.utils.duplicate(data);
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to duplicate template config`, err, data);
    }
  }
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(data);
    } catch (err) {
      console.error(`${MODULE_ID} | structuredClone failed for template config`, err, data);
    }
  }
  try {
    return JSON.parse(JSON.stringify(data));
  } catch (err) {
    console.error(`${MODULE_ID} | JSON clone failed for template config`, err, data);
  }
  return { ...data };
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

async function rollAndApplyDamage(actor, {
  hpFormula = null,
  moraleFormula = null,
  sourceActor = null,
  magical = false
} = {}) {
  if (!actor) return { hp: 0, morale: 0, resistanceBlocked: 0 };
  const hpRoll = hpFormula ? await (new Roll(hpFormula).evaluate({})) : null;
  const moraleRoll = moraleFormula ? await (new Roll(moraleFormula).evaluate({})) : null;
  const adjusted = await adjustIncomingDamage(actor, sourceActor, {
    damage: Number(hpRoll?.total ?? 0),
    moraleBonus: Number(moraleRoll?.total ?? 0),
    damageType: "aoe",
    isMagical: Boolean(magical),
    isAoE: true
  });
  const hp = Math.max(0, Number(adjusted.damage ?? 0));
  const morale = await adjustMoraleLoss(actor, sourceActor, {
    total: Math.max(0, Number(adjusted.moraleBonus ?? 0)),
    baseDamage: 0,
    bonus: Math.max(0, Number(adjusted.moraleBonus ?? 0))
  });
  const origin = getOrigin(actor);
  const hpBefore = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
  if (hpRoll) {
    const result = await adjustFlag(actor, "hp", -hp, "hpMax");
    const hpAfter = result.after;
    if (hpBefore > 0 && hpAfter <= 0) {
      await postDefeatLine(actor, "W4SQ.ChatHPZero");
    }
  }
  if (moraleRoll) {
    const result = await adjustFlag(actor, "morale", -morale, "moraleMax");
    const moraleAfter = result.after;
    const moraleBefore = result.before;
    const moraleMax = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 0);
    if (moraleBefore > 0 && moraleAfter <= 0) {
      if (origin !== "undead") {
        await ensureEffect(actor, {
          key: "routed",
          label: game.i18n.localize("W4SQ.EffectRouted"),
          duration: 99,
          mods: { tags: { routed: true, disorganized: true } }
        }, effect => Boolean(effect?.mods?.tags?.routed));
      }
      await handleMoraleZero(actor, sourceActor);
      await postDefeatLine(actor, "W4SQ.ChatMoraleZero");
    } else if (origin !== "undead" && moraleMax > 0 && moraleAfter / moraleMax < 0.5) {
      await ensureDisorganized(actor, { source: "morale" });
    }
  }
  return { hp, morale, resistanceBlocked: Number(adjusted.resistanceBlocked ?? 0) };
}

async function postFireballResult(sourceActor, entries) {
  if (!entries.length) {
    await postZoneChat(sourceActor, "W4SQ.ChatFireballMiss", {
      name: sourceActor?.name ?? game.i18n.localize("W4SQ.UnknownSquad")
    });
    return;
  }
  const targets = entries.map(entry => escapeName(entry.actor)).join(", ");
  const hp = entries.reduce((total, entry) => total + entry.damage.hp, 0);
  const morale = entries.reduce((total, entry) => total + entry.damage.morale, 0);
  const resistance = entries.reduce((total, entry) => total + entry.damage.resistanceBlocked, 0);
  const key = entries.length === 1 ? "W4SQ.ChatAoEFireballSingle" : "W4SQ.ChatAoEFireballMulti";
  const content = `<p>${game.i18n.format(key, {
    target: targets,
    targets,
    hp,
    morale
  })}</p>${resistance > 0 ? `<p>${game.i18n.format("W4SQ.ChatNonMagicalResistance", { total: resistance })}</p>` : ""}`;
  await ChatMessage.create({
    speaker: sourceActor ? ChatMessage.getSpeaker({ actor: sourceActor }) : {},
    content
  });
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
  const activeDuration = Math.max(1, Number(zone?.remainingRounds ?? 1));
  await removeEffectByKey(actor, baseKey);
  const baseTags = { fortified: true, braced: true };
  if (zone?.casterActorId && actor.id === zone.casterActorId) {
    baseTags.immobile = true;
  }
  await addEffect(actor, {
    key: baseKey,
    label: game.i18n.localize("W4SQ.ManeuverFortify"),
    duration: activeDuration,
    mods: { defSoakDice: "+10+2d10", tags: baseTags }
  });

  if (zone?.casterActorId && actor.id === zone.casterActorId) {
    const key = deepDefenseKey(document, actor);
    await removeEffectByKey(actor, key);
    await addEffect(actor, {
      key,
      label: game.i18n.localize("W4SQ.EffectDeepDefense"),
      duration: activeDuration,
      mods: { defSoakDice: "+20+2d20", tags: { deepDefense: true } }
    });
  } else {
    await removeEffectByKey(actor, deepDefenseKey(document, actor));
  }
}

const ZONE_HANDLERS = {
  fireball: {
    duration: 1,
    template: { type: "circle", radiusUnits: 3 },
    target: "any",
    async onPlaced({ document, tokens, zone, sourceActor }) {
      if (zone.resolution?.status) return;
      let resolution = { status: "resolving", targetIds: tokens.map(token => token.id) };
      zone = await updateZone(document, zone, { resolution });
      try {
        const entries = [];
        for (const token of tokens) {
          const actor = token?.actor;
          if (!actor) continue;
          const damage = await rollAndApplyDamage(actor, {
            hpFormula: "3d20",
            moraleFormula: "4d20",
            sourceActor,
            magical: true
          });
          entries.push({ actor, damage });
        }
        await postFireballResult(sourceActor, entries);
        resolution = { ...resolution, status: "complete" };
        await updateZone(document, zone, { resolution });
        await document.delete();
      } catch (err) {
        resolution = { ...resolution, status: "failed", message: err?.message ?? String(err) };
        try {
          await updateZone(document, getZoneData(document) ?? zone, { resolution });
        } catch (stateErr) {
          console.error(`${MODULE_ID} | Failed to persist Fireball failure state`, stateErr);
        }
        console.error(`${MODULE_ID} | Fireball impact failed; template retained`, {
          zoneId: document.id,
          targets: resolution.targetIds,
          error: err
        });
        ui.notifications?.error?.(game.i18n.localize("W4SQ.ChatFireballFailure"));
      }
    }
  },
  firestorm: {
    duration: 3,
    template: { type: "circle", radiusUnits: 4 },
    target: "any",
    roundOnly: true,
    moveSquares: 3,
    async onEnter({ actor, document, zone }) {
      const duration = zone.remainingRounds ?? 1;
      const key = `zone-firestorm-${document.id}-${actor.id}`;
      const label = game.i18n.localize("W4SQ.ManeuverFirestorm");
      await ensureEffect(actor, {
        key,
        label,
        duration,
        mods: { tags: { zoneFirestorm: true, [`zone-${document.id}`]: true } }
      }, effect => effect.key === key);
    },
    async onTurn({ actor, sourceActor }) {
      const damage = await rollAndApplyDamage(actor, {
        hpFormula: "4d20",
        moraleFormula: "6d20",
        sourceActor,
        magical: true
      });
      await postZoneChat(sourceActor ?? actor, "W4SQ.ChatFirestormPulse", {
        name: actor.name ?? game.i18n.localize("W4SQ.UnknownSquad"),
        hp: damage.hp,
        morale: damage.morale
      });
    },
    async onExit({ actor, document }) {
      if (!actor) return;
      await removeEffectByKey(actor, `zone-firestorm-${document.id}-${actor.id}`);
    }
  },
  lineDefense: {
    duration: 3,
    template: { type: "circle", radiusUnits: 1.5 },
    target: "allies",
    async onEnter({ actor, document, zone }) {
      const duration = zone.remainingRounds ?? 1;
      const key = `zone-line-defense-${document.id}-${actor.id}`;
      await ensureEffect(actor, {
        key,
        label: game.i18n.localize("W4SQ.ManeuverLineDefense"),
        duration,
        mods: { defSoakDice: "+2d10", tags: { braced: true, fortified: true } }
      }, effect => effect.key === key);
    },
    async onExit({ actor, document }) {
      if (!actor) return;
      await removeEffectByKey(actor, `zone-line-defense-${document.id}-${actor.id}`);
    }
  },
  minefield: {
    duration: 3,
    template: { type: "circle", radiusUnits: 1.5 },
    target: "enemies",
    singleUse: true,
    async onEnter({ actor, document, zone, sourceActor }) {
      if (zone.triggered) return;
      const hpRoll = await (new Roll("3d20").evaluate({}));
      const moraleRoll = await (new Roll("4d20").evaluate({}));
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
      const hpRoll = await (new Roll("2d10").evaluate({}));
      const moraleRoll = await (new Roll("2d10").evaluate({}));
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
    template: { type: "circle", radiusUnits: 3.5 },
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

export function createZoneState({
  type,
  casterTokenId = null,
  duration,
  magical = false,
  movementSquares,
  position = null,
  template = {}
} = {}) {
  const zoneType = type === "fortify" ? "fortifyPosition" : type;
  const handler = getZoneHandler(zoneType);
  if (!handler) throw new Error(`${MODULE_ID} | Unknown zone type: ${type}`);
  const casterToken = casterTokenId ? canvas?.tokens?.get(casterTokenId) ?? null : null;
  const createdRound = game.combat ? Number(game.combat.round ?? 0) : null;
  const squares = Number(movementSquares ?? handler.moveSquares ?? 0) || 0;
  return {
    type: zoneType,
    casterActorId: casterToken?.actor?.id ?? null,
    casterTokenId,
    disposition: casterToken?.document?.disposition ?? null,
    target: handler.target ?? "any",
    magical: Boolean(magical),
    createdRound,
    remainingRounds: duration ?? handler.duration ?? null,
    lastAdvancedRound: createdRound,
    movement: {
      squares,
      direction: squares ? randomDirection().label : null,
      lastPosition: position ? { x: Number(position.x) || 0, y: Number(position.y) || 0 } : null
    },
    template,
    occupants: [],
    actorTurnTriggers: {},
    triggered: false,
    resolution: null
  };
}

function getZoneData(document) {
  return document?.getFlag(MODULE_ID, FLAG_KEY) ?? null;
}

function canonicalZoneState(zone, legacyAoE = null, position = null) {
  if (!zone && !legacyAoE) return null;
  const existingSquares = Number(zone?.movement?.squares ?? 0) || 0;
  const hasCanonicalMovement = !existingSquares || (zone?.movement?.direction && zone?.movement?.lastPosition);
  if (zone?.type && Object.prototype.hasOwnProperty.call(zone, "remainingRounds") && hasCanonicalMovement) return zone;
  const type = zone?.type ?? zone?.key ?? legacyAoE?.aoeType ?? null;
  if (!type) return null;
  const handler = getZoneHandler(type);
  const createdRound = zone?.createdRound ?? zone?.extra?.placedRound ?? legacyAoE?.placedRound ?? null;
  const movementSquares = Number(zone?.movement?.squares ?? legacyAoE?.data?.movePerRound ?? handler?.moveSquares ?? 0) || 0;
  return {
    type,
    casterActorId: zone?.casterActorId ?? zone?.actorId ?? null,
    casterTokenId: zone?.casterTokenId ?? zone?.tokenId ?? legacyAoE?.casterTokenId ?? null,
    disposition: zone?.disposition ?? null,
    target: zone?.target ?? handler?.target ?? "any",
    magical: Boolean(zone?.magical ?? zone?.extra?.magical ?? legacyAoE?.data?.magical),
    createdRound,
    remainingRounds: zone?.remainingRounds ?? zone?.duration ?? legacyAoE?.remaining ?? legacyAoE?.duration ?? handler?.duration ?? null,
    lastAdvancedRound: zone?.lastAdvancedRound ?? zone?.extra?.lastLifecycleRound ?? legacyAoE?.lastRound ?? createdRound,
    movement: {
      squares: movementSquares,
      direction: zone?.movement?.direction ?? legacyAoE?.direction ?? (movementSquares ? randomDirection().label : null),
      lastPosition: zone?.movement?.lastPosition ?? position
    },
    template: zone?.template ?? handler?.template ?? {},
    occupants: normalizeOccupants(zone?.occupants ?? legacyAoE?.occupants),
    actorTurnTriggers: { ...(zone?.actorTurnTriggers ?? zone?.extra?.actorTicks ?? {}) },
    triggered: Boolean(zone?.triggered ?? legacyAoE?.spent),
    resolution: zone?.resolution ?? null
  };
}

async function migrateZoneDocument(document) {
  if (!document) return null;
  const zone = getZoneData(document);
  const legacyAoE = document.getFlag(MODULE_ID, "aoe") ?? null;
  const canonical = canonicalZoneState(zone, legacyAoE, { x: document.x ?? 0, y: document.y ?? 0 });
  if (!canonical) return null;
  if (canonical !== zone) {
    document._w4sqSkipEnter = true;
    await document.setFlag(MODULE_ID, FLAG_KEY, canonical);
  }
  if (legacyAoE) {
    document._w4sqSkipEnter = true;
    await document.unsetFlag(MODULE_ID, "aoe");
  }
  return canonical;
}

export async function migrateZoneDocuments(scene = canvas?.scene) {
  const documents = scene?.templates?.contents ?? scene?.templates ?? [];
  for (const document of documents) {
    await migrateZoneDocument(document);
  }
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

function templateConfigFor(zone, handler, document) {
  const base = handler?.template ? duplicateConfig(handler.template) : {};
  if (zone?.template) {
    return foundry.utils.mergeObject(base, zone.template, { inplace: false });
  }
  if (document?.t && !base.type) {
    base.type = document.t;
  }
  return base;
}

function unitsToPixels(units) {
  const size = gridSize() || 100;
  const distance = gridDistance() || 1;
  if (!distance) return units;
  return units * (size / distance);
}

function normalizeAngle(degrees = 0) {
  return (Number(degrees) || 0) * (Math.PI / 180);
}

function rotatePoint(dx, dy, radians) {
  if (!radians) return { x: dx, y: dy };
  const cos = Math.cos(-radians);
  const sin = Math.sin(-radians);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos
  };
}

function circleContains({ center, radiusPx }, point) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return (dx * dx + dy * dy) <= (radiusPx * radiusPx);
}

function rectContains({ center, halfWidthPx, halfHeightPx, angle }, point) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const rotated = rotatePoint(dx, dy, angle);
  return Math.abs(rotated.x) <= halfWidthPx && Math.abs(rotated.y) <= halfHeightPx;
}

function tokensInTemplate(document, handler) {
  const zone = getZoneData(document) ?? {};
  const tokens = canvas?.tokens?.placeables ?? [];
  if (!tokens.length) return [];
  const config = templateConfigFor(zone, handler, document);
  const type = (config.type ?? document?.t ?? "circle").toLowerCase();
  const angle = normalizeAngle(document?.direction ?? config.direction ?? 0);
  const center = { x: document?.x ?? 0, y: document?.y ?? 0 };

  const matches = tokens.filter(token => {
    if (!tokenMatchesTarget(zone, handler, token)) return false;
    const point = tokenCenter(token);
    if (type === "rect" || type === "rectangle") {
      const widthUnits = Number(config.widthUnits ?? config.width ?? 0) || Number(document?.distance ?? 0) || 0;
      const heightUnits = Number(config.heightUnits ?? config.height ?? 0) || Number(document?.width ?? 0) || widthUnits;
      const halfWidthPx = unitsToPixels(widthUnits) / 2;
      const halfHeightPx = unitsToPixels(heightUnits) / 2;
      if (!halfWidthPx || !halfHeightPx) return false;
      return rectContains({ center, halfWidthPx, halfHeightPx, angle }, point);
    }

    const radiusUnits = Number(config.radiusUnits ?? config.distance ?? config.radius ?? document?.distance ?? 0);
    const radiusPx = unitsToPixels(radiusUnits);
    if (!radiusPx) return false;
    return circleContains({ center, radiusPx }, point);
  });

  return matches;
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

async function updateZone(document, zone, changes) {
  if (!document || !zone) return zone;
  const updated = foundry.utils.mergeObject(zone, changes, { inplace: false });
  try {
    document._w4sqSkipEnter = true;
    await document.setFlag(MODULE_ID, FLAG_KEY, updated);
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to update zone state`, err);
    throw err;
  } finally {
    document._w4sqSkipEnter = false;
  }
  return getZoneData(document) ?? updated;
}

async function applyZone(document, handler, tokens) {
  const zone = getZoneData(document);
  if (!zone || !handler?.onEnter) return;
  const sourceActor = zone.casterActorId ? game.actors?.get(zone.casterActorId) ?? null : null;
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
    const sourceActor = zone.casterActorId ? game.actors?.get(zone.casterActorId) ?? null : null;
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
    if (!document?.id) {
      try {
        if (typeof document?.updateSource === "function") {
          document.updateSource({ [flagKey]: updated });
        } else {
          document.flags = document.flags ?? {};
          document.flags[MODULE_ID] = document.flags[MODULE_ID] ?? {};
          document.flags[MODULE_ID][FLAG_KEY] = updated;
        }
      } catch (err) {
        console.error(`${MODULE_ID} | Failed to cache zone occupants on preview`, err);
      }
    } else {
      await updateZone(document, zone, { occupants: currentRecords });
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

function moveUpdate(document, zone) {
  const squares = Number(zone.movement?.squares ?? 0);
  if (!squares) return { update: {}, direction: zone.movement?.direction ?? null, position: null };
  const dir = DIRECTIONS.find(candidate => candidate.label === zone.movement?.direction) ?? randomDirection();
  const dist = squareDistance(squares);
  const dx = dir.dx * dist;
  const dy = dir.dy * dist;
  const previous = zone.movement?.lastPosition ?? { x: document.x ?? 0, y: document.y ?? 0 };
  if (!dx && !dy) return { update: {}, direction: dir.label, position: previous };
  const position = { x: Number(previous.x ?? 0) + dx, y: Number(previous.y ?? 0) + dy };
  return { update: position, direction: dir.label, position };
}

async function handleRoundEffects(document, handler, zone, tokensOverride, { context = {} } = {}) {
  if (!handler?.onRound) {
    return { triggered: false, zone };
  }
  const tokens = tokensOverride ?? tokensInTemplate(document, handler);
  let currentZone = zone;
  const sourceActor = currentZone.casterActorId ? game.actors?.get(currentZone.casterActorId) ?? null : null;
  let triggered = false;
  for (const token of tokens) {
    const actor = token?.actor;
    if (!actor) continue;
    await handler.onRound({ actor, token, document, zone: currentZone, sourceActor });
    triggered = true;
  }

  return { triggered, zone: currentZone };
}

export async function handleZoneTemplateCreated(document) {
  if (!document) return;
  if (document._w4sqSkipEnter) {
    document._w4sqSkipEnter = false;
    return;
  }
  const zone = await migrateZoneDocument(document);
  if (!zone) return;
  const handler = getZoneHandler(zone.type);
  if (!handler) return;
  const tokens = tokensInTemplate(document, handler);
  if (typeof handler.onPlaced === "function") {
    const sourceActor = zone.casterActorId ? game.actors?.get(zone.casterActorId) ?? null : null;
    await handler.onPlaced({ document, tokens, zone, sourceActor });
    return;
  }
  await syncZoneOccupants(document, handler, tokens);
}

export async function handleZoneTokenMove(tokenDoc, changes) {
  if (!tokenDoc) return;
  if (changes && !("x" in changes) && !("y" in changes)) return;
  const token = canvas?.tokens?.get(tokenDoc.id);
  if (!token) return;
  const templates = canvas?.templates?.placeables ?? [];
  for (const template of templates) {
    const zone = await migrateZoneDocument(template.document);
    if (!zone) continue;
    const handler = getZoneHandler(zone.type);
    if (!handler) continue;
    const tokens = tokensInTemplate(template.document, handler);
    await syncZoneOccupants(template.document, handler, tokens);
  }
}

export async function handleZoneTokenCreated(tokenDoc) {
  await handleZoneTokenMove(tokenDoc, { x: tokenDoc.x, y: tokenDoc.y });
}

export async function handleZoneTemplateDeleted(document) {
  const zone = canonicalZoneState(
    getZoneData(document),
    document?.getFlag(MODULE_ID, "aoe") ?? null,
    { x: document?.x ?? 0, y: document?.y ?? 0 }
  );
  if (!zone) return;
  const handler = getZoneHandler(zone.type);
  if (typeof handler?.onExit !== "function") return;
  const sourceActor = zone.casterActorId ? game.actors?.get(zone.casterActorId) ?? null : null;
  for (const record of normalizeOccupants(zone.occupants)) {
    const token = canvas?.tokens?.get(record.tokenId) ?? null;
    const actor = token?.actor ?? (record.actorId ? game.actors?.get(record.actorId) ?? null : null);
    if (!actor) continue;
    await handler.onExit({ actor, token, document, zone, sourceActor });
  }
}

export function getZoneHandlers() {
  return ZONE_HANDLERS;
}

export async function tickZones({ isRoundStart = false, context = {} } = {}) {
  if (!canvas?.scene) return;
  const documents = canvas.scene.templates?.contents ?? canvas.scene.templates ?? [];
  for (const document of documents) {
    let zone = null;
    const currentRound = context?.round ?? null;
    try {
      zone = await migrateZoneDocument(document);
      if (!zone) continue;
      const handler = getZoneHandler(zone.type);
      if (!handler) continue;
      if (handler.singleUse && zone.triggered) {
        await document.delete();
        continue;
      }

      const shouldAdvance = isRoundStart
        && currentRound != null
        && zone.lastAdvancedRound !== currentRound
        && (zone.createdRound == null || currentRound > zone.createdRound);
      if (!shouldAdvance) continue;

      const finiteDuration = zone.remainingRounds !== null && zone.remainingRounds !== undefined;
      const nextRemaining = finiteDuration ? Math.max(0, Number(zone.remainingRounds) - 1) : null;
      if (finiteDuration && nextRemaining <= 0) {
        await syncZoneOccupants(document, handler, []);
        await document.delete();
        continue;
      }

      const movement = moveUpdate(document, zone);
      if (Object.keys(movement.update).length > 0) {
        document._w4sqSkipEnter = true;
        try {
          await document.update({ x: movement.update.x, y: movement.update.y });
        } finally {
          document._w4sqSkipEnter = false;
        }
      }

      let tokens = tokensInTemplate(document, handler);
      await syncZoneOccupants(document, handler, tokens);
      zone = getZoneData(document) ?? zone;
      if (handler.singleUse && zone.triggered) {
        await document.delete();
        continue;
      }

      tokens = tokensInTemplate(document, handler);
      if (typeof handler.onRound === "function") {
        await handleRoundEffects(document, handler, zone, tokens, { context });
        zone = getZoneData(document) ?? zone;
      }

      await updateZone(document, zone, {
        remainingRounds: nextRemaining,
        lastAdvancedRound: currentRound,
        movement: {
          squares: Number(zone.movement?.squares ?? 0) || 0,
          direction: movement.direction,
          lastPosition: movement.position
        }
      });
    } catch (err) {
      console.error(`${MODULE_ID} | Zone round advancement failed`, {
        zoneId: document?.id ?? null,
        round: currentRound,
        oldPosition: zone?.movement?.lastPosition ?? { x: document?.x ?? null, y: document?.y ?? null },
        documentPosition: { x: document?.x ?? null, y: document?.y ?? null },
        remainingRounds: zone?.remainingRounds ?? null,
        error: err
      });
      throw err;
    }
  }
}

/** Apply turn-triggered zone effects only to the combatant whose turn begins. */
export async function tickZonesForActor(actor, context = {}) {
  if (!actor || !canvas?.scene) return;
  const round = Number(context.round ?? game.combat?.round ?? 0);
  const turn = Number(context.turn ?? game.combat?.turn ?? 0);
  const documents = canvas.scene.templates?.contents ?? canvas.scene.templates ?? [];

  for (const document of documents) {
    let zone = await migrateZoneDocument(document);
    if (!zone) continue;
    const handler = getZoneHandler(zone.type);
    if (typeof handler?.onTurn !== "function") continue;
    const signature = `${context.combatId ?? game.combat?.id ?? "combat"}:${round}:${turn}:${actor.id}:${document.id}`;
    const actorTokens = tokensInTemplate(document, handler).filter(token => token.actor?.id === actor.id);
    if (!actorTokens.length) continue;

    const actorTurnTriggers = { ...(zone.actorTurnTriggers ?? {}) };
    if (actorTurnTriggers[actor.id] === signature) continue;
    actorTurnTriggers[actor.id] = signature;
    zone = await updateZone(document, zone, { actorTurnTriggers });

    const sourceActor = zone.casterActorId ? game.actors?.get(zone.casterActorId) ?? null : null;
    await handler.onTurn({ actor, token: actorTokens[0], document, zone, sourceActor });
  }
}
