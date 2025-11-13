import { FLAG_SCOPE, ROLL } from "../config.js";
import { maneuversFor, onManeuverFail, friendlyTokensNear } from "../logic/maneuvers.js";
import { aggregateForManeuvers, actorHasTag } from "../logic/effects.js";
import { getCooldown, setCooldown } from "../logic/cooldowns.js";
import { maybeTriggerHoB } from "../logic/hob.js";
import { canChannel, hasChannelledMagic, isSpecialist, consumeSpecialistEcho, consumeEngineerGenius, triggerMajorPeril } from "../logic/specialists.js";

function diffMod(difficulty) {
  switch (difficulty) {
    case "easy": return 0;
    case "average": return -10;
    case "hard": return -20;
    default: return 0;
  }
}

async function rollMaybe(expr) {
  const s = (expr || "0").trim();
  if (!s || s === "0") return 0;
  const roll = await (new Roll(s).roll({ async: true }));
  return roll.total;
}

function clampTN(value) {
  return Math.min(ROLL.maxTN, Math.max(ROLL.minTN, value));
}

function applySpecialistTN(actor, tn, hp, hpMax) {
  if (!isSpecialist(actor)) return clampTN(tn);
  const max = Math.max(0, Number(hpMax) || 0);
  const ratio = max > 0 ? Math.max(0, Math.min(1, Number(hp) / max)) : 0;
  const capped = Math.min(90, tn);
  return clampTN(Math.max(ROLL.minTN, Math.floor(capped * ratio)));
}

function renderHoBNotes(notes) {
  if (!notes || !notes.length) return "";
  const header = `<p><strong>${game.i18n.localize("W4SQ.ChatHoBHeading")}</strong></p>`;
  const items = notes.map(note => {
    const detail = note?.detail ? ` — ${note.detail}` : "";
    return `<li><strong>${note?.title ?? ""}</strong>${detail}</li>`;
  }).join("");
  return `<div class="hob-notes">${header}<ul>${items}</ul></div>`;
}

function isFriendly(actor, targetToken) {
  if (!actor || !targetToken) return false;
  const originTokens = actor.getActiveTokens(true) ?? [];
  const origin = originTokens[0];
  if (!origin) return false;
  return origin.document?.disposition === targetToken.document?.disposition;
}

function guardRangeDistance() {
  return (canvas?.dimensions?.distance ?? canvas?.grid?.distance ?? 5);
}

function isAdjacentAlly(actor, target) {
  if (!actor || !target) return false;
  const distance = guardRangeDistance();
  const nearby = friendlyTokensNear(actor, distance);
  if (!nearby.length) return false;
  const targetTokens = target.getActiveTokens?.(true) ?? [];
  if (!targetTokens.length) return false;
  const ids = new Set(targetTokens.map(t => t.id));
  return nearby.some(token => ids.has(token.id));
}

function validateManeuverPrereqs(actor, maneuver, target) {
  if (actorHasTag(actor, "spentManeuver")) {
    ui.notifications.warn(game.i18n.localize("W4SQ.ManeuverSpent"));
    return false;
  }
  if (maneuver.category === "specialist") {
    if (maneuver.specialistType === "mage") {
      if (maneuver.key === "channelMagic") {
        if (!canChannel(actor)) {
          ui.notifications.warn(game.i18n.localize("W4SQ.ChannelBlocked"));
          return false;
        }
      } else if (!hasChannelledMagic(actor)) {
        ui.notifications.warn(game.i18n.localize("W4SQ.ChannelRequired"));
        return false;
      }
    }
    if (maneuver.specialistType === "engineer") {
      if (actorHasTag(actor, "immobile")) {
        ui.notifications.warn(game.i18n.localize("W4SQ.EngineerImmobile"));
        return false;
      }
    }
  }
  if (maneuver.key === "guard") {
    const role = actor.getFlag(FLAG_SCOPE, "role") || "infantry";
    if (role !== "infantry") {
      ui.notifications.warn(game.i18n.localize("W4SQ.GuardRole"));
      return false;
    }
    const forbidden = ["disorganized", "engaged", "prone"];
    for (const tag of forbidden) {
      if (actorHasTag(actor, tag)) {
        ui.notifications.warn(game.i18n.localize("W4SQ.GuardUnavailable"));
        return false;
      }
    }
    if (!target || target === actor) {
      ui.notifications.warn(game.i18n.localize("W4SQ.GuardTarget"));
      return false;
    }
    if (!isAdjacentAlly(actor, target)) {
      ui.notifications.warn(game.i18n.localize("W4SQ.GuardRange"));
      return false;
    }
  }
  return true;
}

async function resolveTarget(actor, maneuver) {
  if (maneuver.target === "self") return actor;
  if (maneuver.target === "none") return null;
  const targets = [...game.user.targets];
  if (targets.length !== 1) {
    ui.notifications.warn(game.i18n.localize("W4SQ.WarnSelectTarget"));
    return undefined;
  }
  const token = targets[0];
  const targetActor = token?.actor;
  if (!targetActor) return null;
  if (maneuver.target === "ally" && !isFriendly(actor, token)) {
    ui.notifications.warn(game.i18n.localize("W4SQ.WarnSelectAlly"));
    return undefined;
  }
  return targetActor;
}

export async function openManeuverDialog(actor) {
  const maneuvers = maneuversFor(actor).map(m => ({
    ...m,
    cooldown: getCooldown(actor, m.key)
  }));

  const content = await renderTemplate(`modules/wfrp4e-squads/templates/maneuver-dialog.hbs`, { maneuvers });

  return Dialog.prompt({
    title: game.i18n.localize("W4SQ.Maneuvers"),
    content,
    label: game.i18n.localize("W4SQ.Roll"),
    callback: async html => {
      const root = html?.[0] ?? html;
      const select = root?.querySelector("select[name=maneuver]");
      const key = select?.value;
      if (!key) return;
      const maneuver = maneuvers.find(m => m.key === key);
      if (!maneuver) return;
      if (maneuver.cooldown > 0) {
        ui.notifications.warn(game.i18n.localize("W4SQ.OnCooldown"));
        return;
      }
      await executeManeuver(actor, maneuver);
    }
  });
}

async function executeManeuver(actor, maneuver) {
  const target = await resolveTarget(actor, maneuver);
  if (target === undefined) return;
  if (!validateManeuverPrereqs(actor, maneuver, target)) return;

  const exp = Number(actor.getFlag(FLAG_SCOPE, "experienceTier") || 0);
  const eq = Number(actor.getFlag(FLAG_SCOPE, "equipmentTier") || 0);
  const morale = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
  const moraleMax = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 1);
  const hp = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
  const hpMax = Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 1);

  let tn = ROLL.baseTN + exp * 7 + eq * 5 + diffMod(maneuver.difficulty);
  tn += await rollMaybe(aggregateForManeuvers(actor));
  if (moraleMax > 0 && morale / moraleMax < 0.3) tn -= 10;
  if (hp <= 0) tn -= 20;
  tn = applySpecialistTN(actor, tn, hp, hpMax);

  let autoPassFlag = !!actor.getFlag(FLAG_SCOPE, "hob_autoPassManeuver");
  if (autoPassFlag) {
    await actor.setFlag(FLAG_SCOPE, "hob_autoPassManeuver", false);
  }
  let echoAuto = false;
  if (maneuver.category === "specialist" && maneuver.specialistType === "mage" && maneuver.key !== "channelMagic") {
    echoAuto = await consumeSpecialistEcho(actor);
  }
  let engineerAuto = false;
  if (maneuver.category === "specialist" && maneuver.specialistType === "engineer") {
    engineerAuto = await consumeEngineerGenius(actor);
  }
  const autoPass = autoPassFlag || echoAuto || engineerAuto;

  const roll = await (new Roll("1d100").roll({ async: true }));
  let success = roll.total <= tn || autoPass;
  const hobResult = await maybeTriggerHoB(actor, { roll: roll.total, success, type: "maneuver", target });
  const hobNotes = [...(hobResult?.notes ?? [])];
  if (autoPass) {
    hobNotes.push({
      title: game.i18n.localize("W4SQ.ChatAutoPassTitle"),
      detail: game.i18n.localize("W4SQ.ChatAutoPassDetail")
    });
  }
  if (hobResult?.tnAdjustments?.length) {
    const delta = hobResult.tnAdjustments.reduce((sum, adj) => sum + Number(adj.total || 0), 0);
    if (delta) {
      tn = applySpecialistTN(actor, tn + delta, hp, hpMax);
      success = roll.total <= tn || autoPass;
    }
  }
  const hobHtml = renderHoBNotes(hobNotes);

  if (!success) {
    await onManeuverFail(actor, maneuver);
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${game.i18n.format("W4SQ.ManeuverFail", { name: maneuver.name, roll: roll.total, tn })}</p>${hobHtml}`
    });
    return;
  }

  await maneuver.apply({ actor, target, echoAuto });
  const remaining = Number(maneuver.duration ?? 1);
  if (remaining > 0) {
    await actor.setFlag(FLAG_SCOPE, "activeManeuver", {
      key: maneuver.key,
      name: maneuver.name,
      remaining,
      appliedRound: game.combat?.round ?? null,
      appliedTurn: game.combat?.turn ?? null
    });
  } else {
    await actor.unsetFlag(FLAG_SCOPE, "activeManeuver");
  }
  if (maneuver.cooldown) {
    await setCooldown(actor, maneuver.key, maneuver.cooldown);
  }
  if (echoAuto) {
    await triggerMajorPeril(actor, { maneuverKey: maneuver.key, result: "echo" });
  }
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${game.i18n.format("W4SQ.ManeuverSuccess", { name: maneuver.name, roll: roll.total, tn })}</p>${hobHtml}`
  });
}
