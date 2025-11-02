import { FLAG_SCOPE, ROLL } from "../config.js";
import { maneuversFor, onManeuverFail } from "../logic/maneuvers.js";
import { aggregateForManeuvers } from "../logic/effects.js";
import { getCooldown, setCooldown } from "../logic/cooldowns.js";
import { maybeTriggerHoB } from "../logic/hob.js";

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

function renderHoBNotes(notes) {
  if (!notes || !notes.length) return "";
  const header = `<p><strong>${game.i18n.localize("W4SQ.ChatHoBHeading")}</strong></p>`;
  const items = notes.map(note => {
    const detail = note?.detail ? ` — ${note.detail}` : "";
    return `<li><strong>${note?.title ?? ""}</strong>${detail}</li>`;
  }).join("");
  return `<div class="hob-notes">${header}<ul>${items}</ul></div>`;
}

async function resolveTarget(actor, maneuver) {
  if (maneuver.target === "self") return actor;
  const targets = [...game.user.targets];
  if (targets.length !== 1) {
    ui.notifications.warn(game.i18n.localize("W4SQ.WarnSelectTarget"));
    return null;
  }
  return targets[0].actor;
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
  if (!target) return;

  const exp = Number(actor.getFlag(FLAG_SCOPE, "experienceTier") || 0);
  const eq = Number(actor.getFlag(FLAG_SCOPE, "equipmentTier") || 0);
  const morale = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
  const moraleMax = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 1);
  const hp = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);

  let tn = ROLL.baseTN + exp * 7 + eq * 5 + diffMod(maneuver.difficulty);
  tn += await rollMaybe(aggregateForManeuvers(actor));
  if (moraleMax > 0 && morale / moraleMax < 0.3) tn -= 10;
  if (hp <= 0) tn -= 20;
  tn = clampTN(tn);

  const roll = await (new Roll("1d100").roll({ async: true }));
  let success = roll.total <= tn;
  const hobResult = await maybeTriggerHoB(actor, { roll: roll.total, success, type: "maneuver" });
  const hobNotes = hobResult?.notes ?? [];
  if (hobResult?.tnAdjustments?.length) {
    const delta = hobResult.tnAdjustments.reduce((sum, adj) => sum + Number(adj.total || 0), 0);
    if (delta) {
      tn = clampTN(tn + delta);
      success = roll.total <= tn;
    }
  }
  const hobHtml = renderHoBNotes(hobNotes);

  if (!success) {
    await onManeuverFail(actor);
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${game.i18n.format("W4SQ.ManeuverFail", { name: maneuver.name, roll: roll.total, tn })}</p>${hobHtml}`
    });
    return;
  }

  await maneuver.apply({ actor, target });
  if (maneuver.cooldown) {
    await setCooldown(actor, maneuver.key, maneuver.cooldown);
  }
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${game.i18n.format("W4SQ.ManeuverSuccess", { name: maneuver.name, roll: roll.total, tn })}</p>${hobHtml}`
  });
}
