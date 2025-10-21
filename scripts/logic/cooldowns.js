import { FLAG_SCOPE } from "../config.js";

export function getCooldowns(actor) {
  return foundry.utils.duplicate(actor.getFlag(FLAG_SCOPE, "cooldowns") ?? {});
}

export function getCooldown(actor, key) {
  const cds = actor.getFlag(FLAG_SCOPE, "cooldowns") ?? {};
  return Number(cds[key] ?? 0);
}

export async function setCooldown(actor, key, rounds) {
  const cds = getCooldowns(actor);
  cds[key] = Math.max(0, Math.ceil(Number(rounds) || 0));
  await actor.setFlag(FLAG_SCOPE, "cooldowns", cds);
}

export async function clearCooldown(actor, key) {
  const cds = getCooldowns(actor);
  if (key) {
    delete cds[key];
  } else {
    for (const k of Object.keys(cds)) delete cds[k];
  }
  await actor.setFlag(FLAG_SCOPE, "cooldowns", cds);
}

export async function tickCooldowns(actor) {
  const cds = getCooldowns(actor);
  let dirty = false;
  for (const [key, value] of Object.entries(cds)) {
    const next = Math.max(0, Number(value || 0) - 1);
    if (next <= 0) {
      delete cds[key];
    } else {
      cds[key] = next;
    }
    dirty = true;
  }
  if (dirty) {
    await actor.setFlag(FLAG_SCOPE, "cooldowns", cds);
  }
}
