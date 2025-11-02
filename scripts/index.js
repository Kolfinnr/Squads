import { MODULE_ID, ACTOR_TYPES, SETTINGS, FLAG_SCOPE } from "./config.js";
import { SquadActorSheet } from "./sheets/squad-sheet.js";
import { tickEffects } from "./logic/effects.js";
import { tickCooldowns } from "./logic/cooldowns.js";
import { W4SQCommandApp, openCommandDashboard } from "./features/command-dashboard.js";

function isSquadActor(actor) {
  return actor && ACTOR_TYPES.includes(actor.type) && actor.getFlag(FLAG_SCOPE, "hp") !== undefined;
}

function collectSquadActors() {
  const actors = new Map();
  const pushActor = actor => {
    if (!isSquadActor(actor)) return;
    actors.set(actor.id, actor);
  };

  if (game.combat && game.combat.combatants.size) {
    for (const combatant of game.combat.combatants) {
      const token = combatant?.token?.object || canvas?.tokens?.get(combatant.tokenId);
      if (token?.actor) pushActor(token.actor);
      if (combatant?.actor) pushActor(combatant.actor);
    }
  }

  if (!actors.size) {
    for (const token of canvas?.tokens?.placeables ?? []) {
      if (token?.actor) pushActor(token.actor);
    }
  }

  return [...actors.values()];
}

async function tickAllActors() {
  const actors = collectSquadActors();
  for (const actor of actors) {
    await tickEffects(actor);
    await tickCooldowns(actor);
  }
}

const processedRounds = new Map();

function resetProcessedRound(combat) {
  const key = combat?.id ?? combat?._id;
  if (!key) return;
  processedRounds.delete(key);
}

function shouldProcessRound(combat) {
  if (!combat) return false;
  const round = Number(combat.round ?? 0);
  if (round <= 0) return false;
  const key = combat.id ?? combat._id;
  if (!key) return false;
  const last = processedRounds.get(key) ?? 0;
  if (last === round) return false;
  processedRounds.set(key, round);
  return true;
}

async function processRoundTick(combat) {
  if (!combat) return;
  if (!game.user.isGM) return;
  if (!shouldProcessRound(combat)) return;
  await tickAllActors();
}

function safeProcessRoundTick(combat) {
  processRoundTick(combat).catch(err => console.error(`${MODULE_ID} | Failed to process round tick`, err));
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initialising squads v1.0.2`);
  Actors.registerSheet(MODULE_ID, SquadActorSheet, { types: ACTOR_TYPES, makeDefault: false, label: "Squad" });

  Handlebars.registerHelper("eq", (a, b) => a === b);
  Handlebars.registerHelper("gt", (a, b) => Number(a) > Number(b));

  game.settings.register(MODULE_ID, SETTINGS.enableHoB, {
    name: "Enable Heat of Battle events",
    hint: "If disabled, doubles and low HP/Morale events will not trigger.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
});

Hooks.once("ready", () => {
  game.w4sq = game.w4sq || {};
  game.w4sq.openCommand = openCommandDashboard;
});

Hooks.on("combatStart", combat => {
  resetProcessedRound(combat);
  safeProcessRoundTick(combat);
});

Hooks.on("combatRound", combat => {
  safeProcessRoundTick(combat);
});

Hooks.on("updateCombat", (combat, changed) => {
  if (!combat || !changed) return;
  const hasRound = Object.prototype.hasOwnProperty.call(changed, "round");
  const turnReset = Object.prototype.hasOwnProperty.call(changed, "turn") && changed.turn === 0;
  if (hasRound || turnReset) {
    safeProcessRoundTick(combat);
  }
});

Hooks.on("renderTokenHUD", (hud, html) => {
  const token = canvas?.tokens?.get(hud.object.id);
  const actor = token?.actor;
  if (!isSquadActor(actor)) return;
  if (!canSeeSquad(token)) return;

  const btn = document.createElement("div");
  btn.classList.add("control-icon", "w4sq-hud");
  btn.innerHTML = `<i class="fas fa-chess-knight"></i>`;
  btn.title = game.i18n.localize("W4SQ.CommandDashboard");
  btn.addEventListener("click", () => openCommandDashboard(token));
  html.find(".left").append(btn);
});

function canSeeSquad(token) {
  if (game.user.isGM) return true;
  const actor = token?.actor;
  if (!actor) return false;
  const pc = actor.getFlag(FLAG_SCOPE, "playerControlled");
  if (pc === true) return true;
  if (pc === false) return false;
  if (token.isOwner || actor.isOwner) return true;
  return token.document.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
}

function shouldSilenceHoB(app) {
  if (!app) return false;
  const rawTitle = app.title ?? app.options?.title ?? app.label ?? "";
  const title = String(rawTitle).toLowerCase();
  if (!title) return false;
  const localized = game.i18n?.localize?.("W4SQ.HoBGood")?.toLowerCase?.() || "";
  if (!title.includes("heat of battle") && (!localized || !title.includes(localized))) {
    return false;
  }
  try {
    app.close?.({ force: true });
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to dismiss Heat of Battle dialog`, err);
  }
  return true;
}

Hooks.on("renderDialog", app => {
  shouldSilenceHoB(app);
});

Hooks.on("renderApplication", app => {
  if (app instanceof Dialog) return;
  shouldSilenceHoB(app);
});

Hooks.on("deleteCombat", combat => {
  resetProcessedRound(combat);
  W4SQCommandApp.closeAll();
});

Hooks.on("combatEnd", combat => {
  resetProcessedRound(combat);
});
