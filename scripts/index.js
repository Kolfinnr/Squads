// DIAG MODE: remove logs when stable
import { MODULE_ID, ACTOR_TYPES, SETTINGS, FLAG_SCOPE } from "./config.js";
import { SquadActorSheet } from "./sheets/squad-sheet.js";
import { tickEffects, ensureDisorganized, removeEffectsByTag, advanceEffectsByTag } from "./logic/effects.js";
import { tickCooldowns } from "./logic/cooldowns.js";
import { W4SQCommandApp, openCommandDashboard } from "./features/command-dashboard.js";
import { clearSpecialistRoundFlags } from "./logic/specialists.js";
import { getOrigin, handleTurnTick } from "./logic/origins.js";
import { patchFlagOverrides, registerSocketBridge } from "./services/gm-bridge.js";
import * as AOE from "./aoe.js";

const IMPORT_PATHS = [
  "./config.js",
  "./sheets/squad-sheet.js",
  "./logic/effects.js",
  "./logic/cooldowns.js",
  "./features/command-dashboard.js",
  "./logic/specialists.js",
  "./services/gm-bridge.js",
  "./aoe.js"
];

function bridgeRenderChatMessageHook() {
  if (Hooks._w4sqPatchedRenderChatMessage) return;
  Hooks._w4sqPatchedRenderChatMessage = true;
  const originalCallAll = Hooks.callAll.bind(Hooks);
  Hooks.callAll = function patchedCallAll(hook, ...args) {
    if (hook !== "renderChatMessage") {
      return originalCallAll(hook, ...args);
    }
    const [message, html, data] = args;
    const element = html instanceof HTMLElement ? html : html?.[0];
    try {
      originalCallAll("renderChatMessageHTML", message, element, data);
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to forward renderChatMessageHTML`, err);
    }
    const listeners = Array.from(Hooks._hooks?.[hook] ?? []);
    for (const listener of listeners) {
      try {
        listener.fn(...args);
      } catch (err) {
        console.error(`${MODULE_ID} | renderChatMessage handler failed`, err);
      }
      if (listener.once) Hooks.off(hook, listener.fn);
    }
    return listeners.length;
  };
}

function isSquadActor(actor) {
  return actor && ACTOR_TYPES.includes(actor.type) && actor.getFlag(FLAG_SCOPE, "hp") !== undefined;
}

async function enforceMoraleState(actor) {
  const moraleMax = Number(actor?.getFlag(FLAG_SCOPE, "moraleMax") || 0);
  if (!moraleMax) return;
  const morale = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
  if (getOrigin(actor) === "undead") return;
  if (moraleMax > 0 && morale / moraleMax < 0.5) {
    await ensureDisorganized(actor, { source: "morale" });
  }
}

async function reduceActiveManeuver(actor) {
  const current = actor.getFlag(FLAG_SCOPE, "activeManeuver");
  if (!current) return;
  if (typeof current !== "object") {
    await actor.unsetFlag(FLAG_SCOPE, "activeManeuver");
    return;
  }
  let active;
  try {
    active = foundry.utils.duplicate(current);
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to duplicate active maneuver`, err, current);
    await actor.unsetFlag(FLAG_SCOPE, "activeManeuver");
    return;
  }
  const remaining = Math.max(0, Number(active.remaining ?? 0) - 1);
  if (remaining <= 0) {
    await actor.unsetFlag(FLAG_SCOPE, "activeManeuver");
  } else {
    active.remaining = remaining;
    await actor.setFlag(FLAG_SCOPE, "activeManeuver", active);
  }
}

async function tickActorEntry(actor, context = {}) {
  if (!actor) return;
  console.log(`[W4SQ] tick actor ${actor.name ?? actor.id}`);
  try {
    await tickEffects(actor);
  } catch (err) {
    console.error(`${MODULE_ID} | tickEffects failed for ${actor?.name || actor?.id}`, err);
  }
  try {
    await tickCooldowns(actor);
  } catch (err) {
    console.error(`${MODULE_ID} | tickCooldowns failed for ${actor?.name || actor?.id}`, err);
  }
  await reduceActiveManeuver(actor);
  await enforceMoraleState(actor);
  await clearSpecialistRoundFlags(actor);
  await handleTurnTick(actor, context);
}

const processedTurns = new Map();
const previousTurnActors = new Map();

function resetProcessedTurn(combat) {
  const key = combat?.id ?? combat?._id;
  if (!key) return;
  processedTurns.delete(key);
  previousTurnActors.delete(key);
}

async function expireEffectsForTurnEntry(actor) {
  if (!actor) return;
  for (const candidate of game.actors?.contents ?? []) {
    await advanceEffectsByTag(candidate, "expiresOnActorTurn", actor.id);
  }
}

function markTurn(combat, round, turn) {
  const key = combat?.id ?? combat?._id;
  if (!key) return { key: null, processed: false };
  const signature = `${round}:${turn}`;
  const last = processedTurns.get(key);
  if (last === signature) {
    console.log("[W4SQ] processTurnTick skipped: same turn as last time", { round, turn });
    return { key, processed: false };
  }
  processedTurns.set(key, signature);
  return { key, processed: true };
}

async function processTurnTick(combat, context = {}) {
  if (!combat) {
    console.log("[W4SQ] processTurnTick skipped: no combat");
    return;
  }
  if (!game.user.isGM) {
    console.log("[W4SQ] processTurnTick skipped: not GM");
    return;
  }
  const round = Number(combat.round ?? 0);
  const turn = Number(combat.turn ?? 0);
  if (round < 0 || turn < 0) {
    console.log("[W4SQ] processTurnTick skipped: invalid round/turn", { round, turn });
    return;
  }
  const { processed } = markTurn(combat, round, turn);
  if (!processed) return;
  const combatant = combat.combatant;
  if (!combatant) {
    console.log("[W4SQ] processTurnTick skipped: no combatant", { round, turn });
    return;
  }
  const isRoundStart = turn === 0;
  const tickContext = {
    ...(context ?? {}),
    combatId: combat.id ?? combat._id ?? null,
    round,
    turn
  };
  const actor = combatant.actor;
  const combatKey = combat.id ?? combat._id;
  const previousActor = previousTurnActors.get(combatKey);
  if (previousActor) {
    await removeEffectsByTag(previousActor, "expiresAtTurnEnd", previousActor.id);
  }
  await expireEffectsForTurnEntry(actor);
  previousTurnActors.set(combatKey, actor);
  if (!isSquadActor(actor)) {
    console.log("[W4SQ] processTurnTick skipped: not a squad actor", { actor: actor?.name });
    return;
  }
  await tickActorEntry(actor, tickContext);
}

function safeProcessTurnTick(combat, context) {
  processTurnTick(combat, context).catch(err => console.error(`${MODULE_ID} | Failed to process turn tick`, err));
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initialising squads v1.0.2`);
  bridgeRenderChatMessageHook();
  patchFlagOverrides();
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

  game.settings.register(MODULE_ID, SETTINGS.showUnassignedToPlayers, {
    name: "Show unassigned squads to players",
    hint: "If disabled, players only see their own bucket on the command dashboard.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.treasury, {
    name: "FOB Treasury",
    hint: "Starting treasury amount for downtime actions on the command dashboard.",
    scope: "world",
    config: true,
    type: Number,
    default: 0
  });
});

Hooks.once("ready", async () => {
  console.log(`${MODULE_ID} | Ready hook executed`);
  registerSocketBridge();
  const module = game.modules.get(MODULE_ID);
  if (!module) {
    console.error(`${MODULE_ID} | Module not found via game.modules – verify module.json id`);
  }

  const modulePath = (() => {
    if (!module) return null;
    const raw = module?.path || module?.data?.path || `modules/${module.id}`;
    if (!raw) return null;
    return raw.endsWith("/") ? raw : `${raw}/`;
  })();

  const scriptsBase = modulePath ? (modulePath.endsWith("scripts/") ? modulePath : `${modulePath}scripts/`) : null;
  const fileExists = globalThis.foundry?.utils?.fileExists
    ? globalThis.foundry.utils.fileExists.bind(globalThis.foundry.utils)
    : null;

  for (const path of IMPORT_PATHS) {
    const resource = path.replace(/^\.\//, "");
    const resolved = scriptsBase ? `${scriptsBase}${resource}` : null;
    let exists = scriptsBase ? "skipped" : "unknown";
    if (resolved && fileExists) {
      try {
        exists = await fileExists(resolved, { strict: true });
      } catch (err) {
        console.error(`${MODULE_ID} | Import check failed for ${path}`, err);
        exists = false;
      }
    } else if (resolved) {
      exists = "unverified";
    }
    console.log(`${MODULE_ID} | Import ${path} →`, {
      exists,
      resource,
      resolved,
      type: typeof resource
    });
  }
  console.log(`${MODULE_ID} | combatRound handlers`, Hooks.events.combatRound);
  game.w4sq = game.w4sq || {};
  game.w4sq.openCommand = openCommandDashboard;
  AOE.registerAoEHooks();
});

Hooks.on("combatStart", combat => {
  console.log("[W4SQ] combatStart fired", combat?.id, combat?.round);
  resetProcessedTurn(combat);
  safeProcessTurnTick(combat, { event: "combatStart" });
});

Hooks.on("combatRound", combat => {
  console.log("[W4SQ] combatRound fired", combat?.id, combat?.round);
  safeProcessTurnTick(combat, { event: "combatRound" });
});

Hooks.on("updateCombat", (combat, changed) => {
  if (!combat || !changed) return;
  const hasRound = Object.prototype.hasOwnProperty.call(changed, "round");
  const turnReset = Object.prototype.hasOwnProperty.call(changed, "turn") && changed.turn === 0;
  const turnChanged = Object.prototype.hasOwnProperty.call(changed, "turn");
  if (hasRound || turnReset || turnChanged) {
    console.log("[W4SQ] updateCombat fired", combat?.id, combat?.round, changed);
    safeProcessTurnTick(combat, { event: "updateCombat", changed });
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
  $(html)
    .find(".left")
    .append(btn);
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
  resetProcessedTurn(combat);
  W4SQCommandApp.closeAll();
});

Hooks.on("combatEnd", combat => {
  resetProcessedTurn(combat);
});
