import { FLAG_SCOPE } from "../config.js";
import { addEffect, ensureEffect } from "../logic/effects.js";

const { randomID } = foundry.utils;

const MUTATION_LABELS = {
  bone_plated_growth: "W4SQ.MutationBonePlatedGrowth",
  iron_hide: "W4SQ.MutationIronHide",
  gaze_dark_gods: "W4SQ.MutationGazeDarkGods",
  regeneration: "W4SQ.MutationRegeneration",
  clawed_limbs: "W4SQ.MutationClawedLimbs",
  shape_shifter: "W4SQ.MutationShapeShifter",
  warped_flesh: "W4SQ.MutationWarpedFlesh",
  ritualistic_sacrifice: "W4SQ.MutationRitualisticSacrifice",
  dancing_shadows: "W4SQ.MutationDancingShadows",
  unholy_speed: "W4SQ.MutationUnholySpeed"
};

function getMutation(actor) {
  return actor?.getFlag?.(FLAG_SCOPE, "chaosMutation") || null;
}

export function mutationLabel(key) {
  return MUTATION_LABELS[key] || key;
}

export function mutationOptions() {
  return Object.keys(MUTATION_LABELS).map(key => ({
    key,
    label: mutationLabel(key)
  }));
}

export async function ensureChaosMutation(actor, tableData) {
  if (!actor) return null;
  const existing = getMutation(actor);
  if (existing) return existing;
  let result = null;
  if (tableData && typeof tableData === "object") {
    const entries = Object.values(tableData);
    if (entries.length) {
      result = entries[Math.floor(Math.random() * entries.length)];
    }
  }
  if (!result) {
    result = Object.keys(MUTATION_LABELS)[Math.floor(Math.random() * Object.keys(MUTATION_LABELS).length)];
  }
  await actor.setFlag(FLAG_SCOPE, "chaosMutation", result);
  return result;
}

export async function applyChaosMutationAttack(actor, context = {}) {
  const mutation = getMutation(actor);
  if (!mutation) return context;
  const next = { ...context };
  switch (mutation) {
    case "bone_plated_growth":
      next.attackTN = (next.attackTN ?? 0) - 10;
      break;
    case "clawed_limbs":
      next.armorPierceBonus = (next.armorPierceBonus ?? 0) + 10;
      break;
    case "warped_flesh": {
      let bonus = actor.getFlag(FLAG_SCOPE, "chaosWarpedBonus");
      if (!Number.isFinite(bonus)) {
        const roll = await new Roll("2d10").evaluate({});
        bonus = 5 + roll.total;
        await actor.setFlag(FLAG_SCOPE, "chaosWarpedBonus", bonus);
      }
      next.attackTN = (next.attackTN ?? 0) - 10;
      next.damageBonus = (next.damageBonus ?? 0) + bonus;
      break;
    }
    case "dancing_shadows":
      next.applyFlanked = true;
      next.damageVsFlanked = (next.damageVsFlanked ?? 0) + 10;
      break;
    case "unholy_speed":
      next.chargeMorale = (next.chargeMorale ?? 0) + 20;
      next.selfMoraleOnCharge = "1d20";
      break;
    case "gaze_dark_gods": {
      const stacks = Number(actor.getFlag(FLAG_SCOPE, "chaosGazeStacks") || 0);
      if (stacks > 0) {
        next.attackTN = (next.attackTN ?? 0) + stacks * 5;
        next.damageBonus = (next.damageBonus ?? 0) + stacks * 5;
        next.resistBonus = (next.resistBonus ?? 0) + stacks * 5;
      }
      break;
    }
    default:
      break;
  }
  return next;
}

export function applyChaosMutationDefense(actor, context = {}) {
  const mutation = getMutation(actor);
  if (!mutation) return context;
  const next = { ...context };
  switch (mutation) {
    case "bone_plated_growth":
      next.incomingMultiplier = Math.min(next.incomingMultiplier ?? 1, 0.9);
      break;
    case "iron_hide":
      next.armorBonus = (next.armorBonus ?? 0) + 10;
      break;
    case "gaze_dark_gods": {
      const stacks = Number(actor.getFlag(FLAG_SCOPE, "chaosGazeStacks") || 0);
      if (stacks > 0) next.resistBonus = (next.resistBonus ?? 0) + stacks * 5;
      break;
    }
    default:
      break;
  }
  return next;
}

export async function handleChaosPostHit(attacker, defender, { success, hpDamage = 0 } = {}) {
  const mutation = getMutation(attacker);
  if (mutation === "gaze_dark_gods") {
    if (success) {
      const current = Number(attacker.getFlag(FLAG_SCOPE, "chaosGazeStacks") || 0);
      const next = Math.min(8, current + 1);
      await attacker.setFlag(FLAG_SCOPE, "chaosGazeStacks", next);
    } else {
      const roll = await new Roll("1d10").evaluate({});
      const hp = Number(attacker.getFlag(FLAG_SCOPE, "hp") || 0);
      await attacker.setFlag(FLAG_SCOPE, "hp", Math.max(0, hp - roll.total));
    }
  }
  if (mutation === "shape_shifter" && success && defender) {
    const previous = attacker.getFlag(FLAG_SCOPE, "chaosShapeTargets") || [];
    if (!previous.includes(defender.id)) {
      await attacker.setFlag(FLAG_SCOPE, "chaosShapeTargets", [...previous, defender.id]);
      await ensureEffect(defender, {
        key: randomID?.() ?? `chaos-shape-${Date.now()}`,
        label: game.i18n.localize("W4SQ.MutationShapeShifter"),
        duration: 2,
        mods: { defPenaltyDice: "-1d20", tags: { disorganized: true } }
      }, eff => Boolean(eff?.mods?.tags?.disorganized));
    }
  }
  if (mutation === "ritualistic_sacrifice" && hpDamage > 0) {
    const stacks = Number(attacker.getFlag(FLAG_SCOPE, "chaosRitualStacks") || 0);
    await attacker.setFlag(FLAG_SCOPE, "chaosRitualStacks", Math.min(5, stacks + 1));
  }
}

export function applyChaosDamageTaken(defender, context = {}) {
  const mutation = getMutation(defender);
  if (mutation === "bone_plated_growth") {
    context.damage = Math.floor(context.damage * 0.9);
  }
  if (mutation === "ritualistic_sacrifice") {
    const stacks = Number(defender.getFlag(FLAG_SCOPE, "chaosRitualStacks") || 0);
    context.incomingTNDebuff = (context.incomingTNDebuff ?? 0) + stacks * 5;
  }
  return context;
}

export async function applyChaosRegeneration(actor) {
  const mutation = getMutation(actor);
  if (mutation !== "regeneration") return null;
  const roll = await new Roll("4d10").evaluate({});
  const hp = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
  const hpMax = Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 0);
  const next = Math.min(hpMax, hp + roll.total);
  await actor.setFlag(FLAG_SCOPE, "hp", next);
  return roll.total;
}

export function applyChaosMutationDamageBonus(actor, baseDamage = 0) {
  const mutation = getMutation(actor);
  let damage = baseDamage;
  if (mutation === "warped_flesh") {
    const bonus = Number(actor.getFlag(FLAG_SCOPE, "chaosWarpedBonus") || 0);
    damage += bonus;
  }
  if (mutation === "dancing_shadows") {
    damage += 10;
  }
  if (mutation === "unholy_speed") {
    damage += 0;
  }
  return damage;
}

export function getChaosMutationFlags(actor) {
  return {
    mutation: getMutation(actor),
    gazeStacks: Number(actor.getFlag(FLAG_SCOPE, "chaosGazeStacks") || 0),
    ritualStacks: Number(actor.getFlag(FLAG_SCOPE, "chaosRitualStacks") || 0)
  };
}
