import { MODULE_ID, ACTOR_TYPES, SETTINGS, FLAG_SCOPE } from "./config.js";
import { SquadActorSheet } from "./sheets/squad-sheet.js";
import { tickEffects } from "./logic/effects.js";
import { tickCooldowns } from "./logic/cooldowns.js";
import { W4SQCommandApp, openCommandDashboard } from "./features/command-dashboard.js";

function isSquadActor(actor) {
  return actor && ACTOR_TYPES.includes(actor.type) && actor.getFlag(FLAG_SCOPE, "hp") !== undefined;
}

async function tickAllActors() {
  const actors = game.actors?.contents ?? [];
  for (const actor of actors) {
    if (!isSquadActor(actor)) continue;
    await tickEffects(actor);
    await tickCooldowns(actor);
  }
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

Hooks.on("updateCombat", (combat, diff) => {
  if (!diff) return;
  if (typeof diff.round === "number" && diff.round > 0) {
    tickAllActors();
  }
});

Hooks.on("renderTokenHUD", (hud, html) => {
  const actor = canvas?.tokens?.get(hud.object.id)?.actor;
  if (!isSquadActor(actor)) return;
  if (!canSeeSquad(actor)) return;

  const btn = document.createElement("div");
  btn.classList.add("control-icon", "w4sq-hud");
  btn.innerHTML = `<i class="fas fa-chess-knight"></i>`;
  btn.title = game.i18n.localize("W4SQ.CommandDashboard");
  btn.addEventListener("click", () => openCommandDashboard(actor));
  html.find(".left").append(btn);
});

function canSeeSquad(actor) {
  if (game.user.isGM) return true;
  const pc = actor.getFlag(FLAG_SCOPE, "playerControlled");
  if (pc === true) return true;
  if (pc === false) return false;
  if (actor.isOwner) return true;
  const token = actor.getActiveTokens(true)[0];
  if (token) {
    if (token.isOwner) return true;
    return token.document.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
  }
  return false;
}

Hooks.on("deleteCombat", () => {
  W4SQCommandApp.closeAll();
});
