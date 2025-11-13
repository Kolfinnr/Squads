import { FLAG_SCOPE } from "../config.js";

const COOLDOWN_LABELS = {
  reload: "W4SQ.CooldownReloading",
  cmdRangedPreempt: "W4SQ.CooldownCmdRanged",
  firestorm: "W4SQ.ManeuverFirestorm",
  fireball: "W4SQ.ManeuverFireball",
  doomGloom: "W4SQ.ManeuverDoom",
  transmuteLead: "W4SQ.ManeuverLead",
  revification: "W4SQ.ManeuverRevification",
  fireAspect: "W4SQ.ManeuverFireAspect",
  lineDefense: "W4SQ.ManeuverLineDefense",
  minefield: "W4SQ.ManeuverMinefield",
  wolfPits: "W4SQ.ManeuverWolfPits",
  flashbombs: "W4SQ.ManeuverFlashbombs",
  fortifyPosition: "W4SQ.ManeuverFortify",
  ballisticCalibration: "W4SQ.ManeuverCalibration"
};

function normalizeRounds(value) {
  return Math.max(0, Number(value ?? 0));
}

export function formatCooldownRounds(value) {
  const rounds = normalizeRounds(value);
  if (rounds <= 0) return game.i18n.localize("W4SQ.CooldownReady");
  if (rounds === 1) return game.i18n.localize("W4SQ.TurnSingle");
  return game.i18n.format("W4SQ.TurnPlural", { value: rounds });
}

export function getCooldowns(actor) {
  return foundry.utils.duplicate(actor.getFlag(FLAG_SCOPE, "cooldowns") ?? {});
}

export function getCooldown(actor, key) {
  const cds = actor.getFlag(FLAG_SCOPE, "cooldowns") ?? {};
  return Number(cds[key] ?? 0);
}

async function commitCooldowns(actor, cds) {
  const keys = Object.keys(cds);
  if (!keys.length) {
    await actor.unsetFlag(FLAG_SCOPE, "cooldowns");
  } else {
    await actor.setFlag(FLAG_SCOPE, "cooldowns", cds);
  }
}

export async function setCooldown(actor, key, rounds) {
  const cds = getCooldowns(actor);
  const normalized = Math.max(0, Math.ceil(Number(rounds) || 0));
  if (normalized <= 0) {
    if (key in cds) {
      delete cds[key];
      await commitCooldowns(actor, cds);
    }
    return;
  }
  cds[key] = normalized;
  await commitCooldowns(actor, cds);
}

export async function clearCooldown(actor, key) {
  const cds = getCooldowns(actor);
  if (key) {
    delete cds[key];
  } else {
    for (const k of Object.keys(cds)) delete cds[k];
  }
  await commitCooldowns(actor, cds);
}

export async function tickCooldowns(actor) {
  const cds = getCooldowns(actor);
  let dirty = false;
  for (const [key, value] of Object.entries(cds)) {
    const next = Math.max(0, Number(value || 0) - 1);
    if (next <= 0) {
      delete cds[key];
      dirty = true;
    } else if (next !== value) {
      cds[key] = next;
      dirty = true;
    }
  }
  if (dirty) {
    await commitCooldowns(actor, cds);
  }
}

export function describeCooldown(key) {
  const translation = COOLDOWN_LABELS[key];
  if (translation) return game.i18n.localize(translation);
  return key;
}

export function listCooldowns(actor, { includeZero = false } = {}) {
  return Object.entries(getCooldowns(actor))
    .map(([key, value]) => {
      const rounds = normalizeRounds(value);
      return {
        key,
        label: describeCooldown(key),
        rounds,
        turnsLabel: formatCooldownRounds(rounds)
      };
    })
    .filter(entry => includeZero || entry.rounds > 0);
}
