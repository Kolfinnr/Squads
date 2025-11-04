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

export function actorHasTag(actor, tag) {
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

async function postZoneMessage(actor, key, data = {}) {
  if (!actor) return;
  const speaker = ChatMessage.getSpeaker({ actor });
  const content = `<p>${game.i18n?.format?.(key, data) ?? key}</p>`;
  await ChatMessage.create({ speaker, content });
}

async function applyFlagDelta(actor, key, delta, maxKey = null) {
  const current = Number(actor?.getFlag(FLAG_SCOPE, key) || 0);
  let max = null;
  if (maxKey) {
    max = Number(actor?.getFlag(FLAG_SCOPE, maxKey) || 0) || null;
  }
  let next = current + delta;
  if (max !== null) next = Math.min(max, next);
  next = Math.max(0, next);
  await actor?.setFlag(FLAG_SCOPE, key, next);
  return { before: current, after: next };
}

async function handleSpecialEffect(actor, effect) {
  const tags = effect?.mods?.tags ?? {};
  if (tags.zoneFirestorm) {
    const hpRoll = await (new Roll("4d20").roll({ async: true }));
    const moraleRoll = await (new Roll("6d20").roll({ async: true }));
    await applyFlagDelta(actor, "hp", -hpRoll.total, "hpMax");
    const moraleResult = await applyFlagDelta(actor, "morale", -moraleRoll.total, "moraleMax");
    const moraleMax = Number(actor?.getFlag(FLAG_SCOPE, "moraleMax") || 0);
    if (moraleMax > 0 && moraleResult.after / moraleMax < 0.5) {
      await ensureDisorganized(actor, { source: "zone" });
    }
    await postZoneMessage(actor, "W4SQ.ChatFirestormPulse", {
      name: actor?.name ?? game.i18n.localize("W4SQ.UnknownSquad"),
      hp: hpRoll.total,
      morale: moraleRoll.total
    });
  }
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
  const guardCleanup = [];
  const current = getEffects(actor);
  for (const eff of current) {
    await handleSpecialEffect(actor, eff);
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
      const tags = eff?.mods?.tags ?? {};
      const guardData = eff?.mods?.guard ?? {};
      if (tags.guarding && guardData.targetActorId) {
        guardCleanup.push({ type: "guarding", targetId: guardData.targetActorId, guardId: actor?.id ?? actor?._id ?? null, effect: eff });
      } else if (tags.guarded && guardData.actorId) {
        guardCleanup.push({ type: "guarded", guardId: guardData.actorId, targetId: actor?.id ?? actor?._id ?? null, effect: eff });
      }
      continue;
    }
    next.push({ ...eff, duration: duration - 1 });
  }
  await actor.setFlag(FLAG_SCOPE, "effects", next);

  for (const entry of guardCleanup) {
    if (entry.type === "guarding" && entry.targetId) {
      const targetActor = game.actors?.get(entry.targetId);
      if (targetActor) {
        const effects = getEffects(targetActor);
        const filtered = effects.filter(effect => !(effect?.mods?.tags?.guarded && effect?.mods?.guard?.actorId === entry.guardId));
        if (filtered.length !== effects.length) {
          await targetActor.setFlag(FLAG_SCOPE, "effects", filtered);
        }
      }
    } else if (entry.type === "guarded" && entry.guardId) {
      const guardActor = game.actors?.get(entry.guardId);
      if (guardActor) {
        const effects = getEffects(guardActor);
        const filtered = effects.filter(effect => !(effect?.mods?.tags?.guarding && effect?.mods?.guard?.targetActorId === entry.targetId));
        if (filtered.length !== effects.length) {
          await guardActor.setFlag(FLAG_SCOPE, "effects", filtered);
        }
      }
    }
  }
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

function ensureGuardLabel(templateKey, data) {
  if (game.i18n?.has?.(templateKey)) {
    return game.i18n.format(templateKey, data);
  }
  return data?.name ? `${templateKey.split('.').pop()}: ${data.name}` : templateKey;
}

export async function detachGuardByGuard(guardActor, effect = null) {
  if (!guardActor) return;
  const guardId = guardActor.id ?? guardActor._id ?? null;
  const effects = getEffects(guardActor);
  let guardEffect = effect ?? effects.find(e => e?.mods?.tags?.guarding);
  const targetActorId = guardEffect?.mods?.guard?.targetActorId ?? null;
  if (guardEffect) {
    const filtered = effects.filter(e => e.key !== guardEffect.key);
    if (filtered.length !== effects.length) {
      await guardActor.setFlag(FLAG_SCOPE, "effects", filtered);
    }
  }
  if (targetActorId) {
    const targetActor = game.actors?.get(targetActorId);
    if (targetActor) {
      const targetEffects = getEffects(targetActor);
      const filteredTarget = targetEffects.filter(e => !(e?.mods?.tags?.guarded && e?.mods?.guard?.actorId === guardId));
      if (filteredTarget.length !== targetEffects.length) {
        await targetActor.setFlag(FLAG_SCOPE, "effects", filteredTarget);
      }
    }
  }
}

export async function detachGuardByTarget(targetActor, effect = null) {
  if (!targetActor) return;
  const targetId = targetActor.id ?? targetActor._id ?? null;
  const effects = getEffects(targetActor);
  let guardEffect = effect ?? effects.find(e => e?.mods?.tags?.guarded);
  const guardActorId = guardEffect?.mods?.guard?.actorId ?? null;
  if (guardEffect) {
    const filtered = effects.filter(e => e.key !== guardEffect.key);
    if (filtered.length !== effects.length) {
      await targetActor.setFlag(FLAG_SCOPE, "effects", filtered);
    }
  }
  if (guardActorId) {
    const guardActor = game.actors?.get(guardActorId);
    if (guardActor) {
      const guardEffects = getEffects(guardActor);
      const filteredGuard = guardEffects.filter(e => !(e?.mods?.tags?.guarding && e?.mods?.guard?.targetActorId === targetId));
      if (filteredGuard.length !== guardEffects.length) {
        await guardActor.setFlag(FLAG_SCOPE, "effects", filteredGuard);
      }
    }
  }
}

export async function attachGuard(guardActor, targetActor, { source = "maneuver" } = {}) {
  if (!guardActor || !targetActor) return;
  await detachGuardByGuard(guardActor);
  await detachGuardByTarget(targetActor);

  const guardId = guardActor.id ?? guardActor._id ?? null;
  const targetId = targetActor.id ?? targetActor._id ?? null;
  const guardToken = (guardActor.getActiveTokens?.(true) ?? [])[0] ?? null;
  const targetToken = (targetActor.getActiveTokens?.(true) ?? [])[0] ?? null;

  const guardEffect = {
    key: crypto.randomUUID?.() ?? randomID(),
    label: ensureGuardLabel("W4SQ.EffectGuarding", { name: targetActor.name ?? game.i18n.localize("W4SQ.UnknownSquad") }),
    duration: 1,
    mods: {
      tags: { guarding: true },
      guard: {
        targetActorId: targetId,
        targetTokenId: targetToken?.id ?? null,
        source
      }
    }
  };

  const guardedEffect = {
    key: crypto.randomUUID?.() ?? randomID(),
    label: ensureGuardLabel("W4SQ.EffectGuarded", { name: guardActor.name ?? game.i18n.localize("W4SQ.UnknownSquad") }),
    duration: 1,
    mods: {
      tags: { guarded: true },
      guard: {
        actorId: guardId,
        tokenId: guardToken?.id ?? null,
        source
      }
    }
  };

  await addEffect(guardActor, guardEffect);
  await addEffect(targetActor, guardedEffect);
}

export function findGuardOnTarget(targetActor) {
  if (!targetActor) return null;
  const effects = getEffects(targetActor);
  const targetEffect = effects.find(e => e?.mods?.tags?.guarded && e?.mods?.guard?.actorId);
  if (!targetEffect) return null;
  const guardActorId = targetEffect.mods.guard.actorId;
  let guardActor = guardActorId ? game.actors?.get(guardActorId) : null;
  if (!guardActor && targetEffect.mods.guard.tokenId) {
    guardActor = canvas?.tokens?.get(targetEffect.mods.guard.tokenId)?.actor ?? null;
  }
  if (!guardActor) return null;
  const guardEffects = getEffects(guardActor);
  const guardEffect = guardEffects.find(e => e?.mods?.tags?.guarding && e?.mods?.guard?.targetActorId === (targetActor.id ?? targetActor._id));
  return { guardActor, guardEffect, targetEffect };
}

export async function consumeGuardLink({ guardActor, targetActor, guardEffect, targetEffect } = {}) {
  if (guardActor) {
    await detachGuardByGuard(guardActor, guardEffect ?? null);
  }
  if (targetActor) {
    await detachGuardByTarget(targetActor, targetEffect ?? null);
  }
}

export function isDisorganized(actor) {
  return actorHasTag(actor, "disorganized");
}
