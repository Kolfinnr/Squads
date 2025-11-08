import { FLAG_SCOPE } from "../config.js";
import { addEffect, attachGuard, clearNegative, getEffects, removeDisorganized } from "./effects.js";
import { requestZonePlacement } from "./zones.js";
import {
  isMage,
  isEngineer,
  applyChannelledMagic,
  clearChannelledMagic,
  hasChannelledMagic,
  triggerMinorPeril,
  triggerMajorPeril,
  triggerEngineerMishap,
  canChannel,
  consumeEngineerGenius,
  consumeSpecialistEcho
} from "./specialists.js";

const E = (mods, duration = 1, key = null, label = null) => ({
  key: key || crypto.randomUUID?.() || randomID(),
  label: label || "Effect",
  duration,
  mods
});

async function rollFormula(formula) {
  if (!formula || formula === "0") return { total: 0, formula: "0" };
  const roll = await (new Roll(formula).roll({ async: true }));
  return { total: roll.total, formula: roll.formula };
}

async function adjustFlag(actor, key, amount, { min = 0, maxFlag = null } = {}) {
  if (!actor) return 0;
  const current = Number(actor.getFlag(FLAG_SCOPE, key) || 0);
  let max = null;
  if (maxFlag) {
    max = Number(actor.getFlag(FLAG_SCOPE, maxFlag) || 0) || null;
  }
  let value = current + amount;
  if (max !== null) value = Math.min(max, value);
  value = Math.max(min, value);
  await actor.setFlag(FLAG_SCOPE, key, value);
  return value - current;
}

async function damageHP(actor, dice) {
  const roll = await rollFormula(dice);
  await adjustFlag(actor, "hp", -roll.total, { min: 0, maxFlag: "hpMax" });
  return roll.total;
}

async function healHP(actor, dice) {
  const roll = await rollFormula(dice);
  await adjustFlag(actor, "hp", roll.total, { min: 0, maxFlag: "hpMax" });
  return roll.total;
}

async function damageMorale(actor, dice) {
  const roll = await rollFormula(dice);
  await adjustFlag(actor, "morale", -roll.total, { min: 0, maxFlag: "moraleMax" });
  return roll.total;
}

async function healMorale(actor, dice) {
  const roll = await rollFormula(dice);
  await adjustFlag(actor, "morale", roll.total, { min: 0, maxFlag: "moraleMax" });
  return roll.total;
}

async function postChat(actor, key, data = {}) {
  if (!actor) return;
  const content = `<p>${game.i18n?.format?.(key, data) ?? key}</p>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });
}

async function addMorale(actor, dice) {
  const roll = await (new Roll(dice).roll({ async: true }));
  const cur = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
  const max = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 0);
  await actor.setFlag(FLAG_SCOPE, "morale", Math.min(max, cur + roll.total));
}

async function subMorale(actor, dice) {
  const roll = await (new Roll(dice).roll({ async: true }));
  const cur = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
  await actor.setFlag(FLAG_SCOPE, "morale", Math.max(0, cur - roll.total));
}

export const MANEUVERS = {
  guard: {
    name: "Guard",
    category: "universal",
    difficulty: "easy",
    target: "ally",
    cooldown: 1,
    duration: 1,
    roles: ["infantry"],
    apply: async ({ actor, target }) => {
      if (!target) return;
      await attachGuard(actor, target, { source: "maneuver" });
    }
  },
  flank: {
    name: "Flank",
    category: "universal",
    difficulty: "average",
    target: "enemy",
    apply: async ({ target }) => {
      await addEffect(target, E({ defPenaltyDice: "-1d20", tags: { flanked: true } }, 2, "flanked", "Flanked"));
      await subMorale(target, "1d20");
    }
  },
  reorg: {
    name: "Reorganization",
    category: "universal",
    difficulty: "easy",
    target: "self",
    apply: async ({ actor }) => {
      await clearNegative(actor);
      await removeDisorganized(actor);
      await addMorale(actor, "2d20");
      await addEffect(actor, E({ tnDice: "-1d10", defSoakDice: "-1d10" }, 1, "reorg-pen", "Reorganization Penalty"));
    }
  },
  charge: {
    name: "Charge",
    category: "universal",
    difficulty: "easy",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ tnDice: "+1d20", dmgDice: "+1d20", tags: { charged: true } }, 1, "charge", "Charge"));
    }
  },
  brace: {
    name: "Brace",
    category: "universal",
    difficulty: "easy",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ defSoakDice: "+1d10", tags: { braced: true } }, 1, "brace", "Brace"));
    }
  },
  loose: {
    name: "Loose Formation",
    category: "universal",
    difficulty: "easy",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ rangedResistDice: "+1d20", defPenaltyDice: "-1d20", tags: { looseFormation: true } }, 1, "loose", "Loose Formation"));
    }
  },
  disengage: {
    name: "Disengage",
    category: "universal",
    difficulty: "easy",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ defSoakDice: "+1d10", tags: { disengaged: true } }, 1, "disengage", "Disengage"));
      await actor.setFlag(FLAG_SCOPE, "lastTargetName", "");
    }
  },

  mordhau: {
    name: "Mordhau Swordsmanship",
    category: "weapon",
    weaponType: "sword",
    difficulty: "hard",
    cooldown: 3,
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ tnDice: "+5d10", dmgDice: "+4d10" }, 1, "mordhau", "Mordhau Swordsmanship"));
    }
  },
  riposte: {
    name: "Riposte",
    category: "weapon",
    weaponType: "sword",
    difficulty: "average",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ defSoakDice: "+1d10" }, 1, "riposte", "Riposte"));
    }
  },
  closeGaps: {
    name: "Close the Gaps!",
    category: "weapon",
    weaponType: "sword",
    difficulty: "easy",
    target: "self",
    apply: async ({ actor }) => {
      await addMorale(actor, "1d10");
      await addEffect(actor, E({ defSoakDice: "+1d10", rangedResistDice: "-1d20" }, 1, "gaps", "Close the Gaps"));
    }
  },

  beastRage: {
    name: "Bestial Rage",
    category: "weapon",
    weaponType: "axe",
    difficulty: "hard",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ dmgDice: "+3d20" }, 1, "rage", "Bestial Rage"));
    }
  },
  nimbleAxes: {
    name: "Nimble Fighters",
    category: "weapon",
    weaponType: "axe",
    difficulty: "average",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ defSoakDice: "+1d20", tnDice: "-1d20" }, 1, "nimble", "Nimble Fighters"));
    }
  },
  heavyHits: {
    name: "Heavy Hits",
    category: "weapon",
    weaponType: "axe",
    difficulty: "easy",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ dmgDice: "+1d20", tnDice: "-1d10", defSoakDice: "-1d10" }, 1, "heavy", "Heavy Hits"));
    }
  },

  schiltron: {
    name: "Schiltron",
    category: "weapon",
    weaponType: "polearm",
    difficulty: "hard",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ defSoakDice: "+5d10", tags: { immuneFlank: true, immuneEncircle: true } }, 1, "schiltron", "Schiltron"));
      await addMorale(actor, "1d20");
    }
  },
  phalanx: {
    name: "Phalanx",
    category: "weapon",
    weaponType: "polearm",
    difficulty: "average",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ defSoakDice: "+3d10", tags: { antiCharge: true } }, 1, "phalanx", "Phalanx"));
    }
  },
  polePrecise: {
    name: "Precise Hits",
    category: "weapon",
    weaponType: "polearm",
    difficulty: "easy",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ dmgDice: "+1d10", tags: { armorIgnorePct: 0.25 } }, 1, "pole-prec", "Precise Hits"));
      await addEffect(actor, E({ defSoakDice: "-1d10" }, 1, "pole-pen", "Exposed"));
    }
  },

  bowUncanny: {
    name: "Uncanny Shots",
    category: "weapon",
    weaponType: "bow",
    difficulty: "hard",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ tnDice: "+3d10", dmgDice: "+2d10", tags: { armorIgnorePct: 0.25 } }, 1, "bow-unc", "Uncanny Shots"));
    }
  },
  bowVolley: {
    name: "Volley Fire",
    category: "weapon",
    weaponType: "bow",
    difficulty: "average",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ tags: { multiShot: 2, multiShotHalf: true } }, 1, "bow-volley", "Volley Fire"));
    }
  },
  bowFire: {
    name: "Fire Arrows",
    category: "weapon",
    weaponType: "bow",
    difficulty: "easy",
    target: "enemy",
    apply: async ({ actor, target }) => {
      await addEffect(actor, E({ tnDice: "-1d20", dmgDice: "-1d20" }, 1, "bow-fire", "Awkward Fireshot"));
      const mor = await (new Roll("2d20").roll({ async: true }));
      const hp = await (new Roll("1d10").roll({ async: true }));
      const curMor = Number(target.getFlag(FLAG_SCOPE, "morale") || 0);
      const curHP = Number(target.getFlag(FLAG_SCOPE, "hp") || 0);
      await target.setFlag(FLAG_SCOPE, "morale", Math.max(0, curMor - mor.total));
      await target.setFlag(FLAG_SCOPE, "hp", Math.max(0, curHP - hp.total));
    }
  },

  xbowVolley: {
    name: "Volley Fire",
    category: "weapon",
    weaponType: "crossbow",
    difficulty: "hard",
    cooldown: 2,
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ tags: { multiShot: 2, multiShotHalf: true } }, 1, "xbow-volley", "Volley Fire"));
    }
  },
  xbowTakeDown: {
    name: "Take it Down!",
    category: "weapon",
    weaponType: "crossbow",
    difficulty: "average",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ tnDice: "+3d10", dmgDice: "+3d10" }, 1, "xbow-down", "Take it Down"));
    }
  },
  xbowPrecise: {
    name: "Precise Hits",
    category: "weapon",
    weaponType: "crossbow",
    difficulty: "easy",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ tnDice: "-3d10", tags: { pierceArmor: true } }, 1, "xbow-prec", "Precise Hits"));
    }
  },

  aimShots: {
    name: "Aim Your Shots!",
    category: "weapon",
    weaponType: "firearm",
    difficulty: "hard",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ tags: { skipTurn: true, nextRoundBuff: { tnDice: "+3d10", dmgDice: "+6d10" } } }, 2, "aim", "Aimed Shots"));
    }
  },
  contFire: {
    name: "Continuous Fire",
    category: "weapon",
    weaponType: "firearm",
    difficulty: "average",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ tags: { continuousFire: true, halfDamage: true } }, 3, "cont", "Continuous Fire"));
    }
  },
  reloadFire: {
    name: "Reload!",
    category: "weapon",
    weaponType: "firearm",
    difficulty: "easy",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ tags: { tired: true } }, 1, "reload-f", "Reload"));
    }
  },

  counterBattery: {
    name: "Counter Battery Fire",
    category: "weapon",
    weaponType: "artillery",
    difficulty: "hard",
    target: "enemy",
    apply: async ({ target }) => {
      const roll = await (new Roll("2d20").roll({ async: true }));
      const hp = Number(target.getFlag(FLAG_SCOPE, "hp") || 0);
      await target.setFlag(FLAG_SCOPE, "hp", Math.max(0, hp - roll.total));
    }
  },
  entrench: {
    name: "Entrench!",
    category: "weapon",
    weaponType: "artillery",
    difficulty: "average",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ rangedResistDice: "+4d10", tags: { resistChargeBonus: true } }, 99, "entrench", "Entrenched"));
    }
  },
  reloadArt: {
    name: "Reload!",
    category: "weapon",
    weaponType: "artillery",
    difficulty: "easy",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ tags: { fastReload: true, tired: true } }, 1, "reload-a", "Reload"));
    }
  },

  smokeBomb: {
    name: "Smoke Bomb",
    category: "hybrid",
    difficulty: "average",
    target: "ally",
    apply: async ({ actor, target }) => {
      const effect = E({ tags: { coverAura: true } }, 1, "smoke", "Smoke Bomb");
      await addEffect(actor, effect);
      if (target) {
        await addEffect(target, { ...effect, key: `${effect.key}-ally` });
      }
    }
  },
  cripple: {
    name: "Cripple",
    category: "hybrid",
    difficulty: "hard",
    target: "enemy",
    apply: async ({ target }) => {
      await subMorale(target, "3d10");
      await addEffect(target, E({ tags: { disorganized: true } }, 1, "cripple", "Crippled"));
    }
  },
  ambushSetup: {
    name: "Ambush Setup",
    category: "hybrid",
    difficulty: "average",
    target: "enemy",
    apply: async ({ actor, target }) => {
      await addEffect(target, E({ defPenaltyDice: "-1d20", tags: { flanked: true } }, 1, "ambushed", "Ambushed"));
      await addEffect(actor, E({ dmgDice: "+3d10" }, 1, "ambush-buff", "Ambush Setup"));
    }
  },
  feintRetreat: {
    name: "Feint & Retreat",
    category: "hybrid",
    difficulty: "average",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ dmgDice: "-1/2", tags: { disengaged: true } }, 1, "feint", "Feint & Retreat"));
    }
  },
  shadowplay: {
    name: "Shadowplay",
    category: "hybrid",
    difficulty: "hard",
    target: "self",
    apply: async ({ actor }) => {
      await addEffect(actor, E({ defSoakDice: "+3d10", tags: { freeMove: true } }, 1, "shadow", "Shadowplay"));
    }
  },

  channelMagic: {
    name: "Channel Magic",
    category: "specialist",
    specialistType: "mage",
    difficulty: "average",
    target: "self",
    apply: async ({ actor }) => {
      await applyChannelledMagic(actor);
      await postChat(actor, "W4SQ.ChatChannelMagic", { name: actor.name ?? "" });
    }
  },
  firestorm: {
    name: "Firestorm",
    category: "specialist",
    specialistType: "mage",
    difficulty: "hard",
    cooldown: 4,
    target: "self",
    apply: async ({ actor }) => {
      await requestZonePlacement(actor, "firestorm");
      await clearChannelledMagic(actor);
      await postChat(actor, "W4SQ.ChatFirestormDeploy", { name: actor.name ?? "" });
    }
  },
  fireball: {
    name: "Fireball",
    category: "specialist",
    specialistType: "mage",
    difficulty: "hard",
    cooldown: 4,
    target: "enemy",
    apply: async ({ actor, target }) => {
      if (!target) return;
      const hp = await damageHP(target, "20 + 3d10");
      const morale = await damageMorale(target, "20 + 3d10");
      await clearChannelledMagic(actor);
      await postChat(actor, "W4SQ.ChatFireball", { name: actor.name ?? "", target: target.name ?? "", hp, morale });
    }
  },
  doomGloom: {
    name: "Doom & Gloom",
    category: "specialist",
    specialistType: "mage",
    difficulty: "hard",
    cooldown: 4,
    target: "enemy",
    apply: async ({ actor, target }) => {
      if (!target) return;
      const morale = await damageMorale(target, "50 + 5d10");
      await addEffect(target, E({ tnDice: "-2d20" }, 2, `doom-${randomID()}`, game.i18n.localize("W4SQ.ManeuverDoom")));
      await clearChannelledMagic(actor);
      await postChat(actor, "W4SQ.ChatDoom", { name: actor.name ?? "", target: target.name ?? "", morale });
    }
  },
  transmuteLead: {
    name: "Transmutation of Lead",
    category: "specialist",
    specialistType: "mage",
    difficulty: "hard",
    cooldown: 4,
    target: "enemy",
    apply: async ({ actor, target }) => {
      if (!target) return;
      const eq = Math.max(1, Number(target.getFlag(FLAG_SCOPE, "equipmentTier") || 0));
      const dice = `${eq}d10`;
      await addEffect(target, E({ defSoakDice: `-${dice}` }, 2, `lead-${randomID()}`, game.i18n.localize("W4SQ.ManeuverLead")));
      await clearChannelledMagic(actor);
      await postChat(actor, "W4SQ.ChatLead", { name: actor.name ?? "", target: target.name ?? "", dice });
    }
  },
  revification: {
    name: "Magical Revification",
    category: "specialist",
    specialistType: "mage",
    difficulty: "hard",
    cooldown: 4,
    target: "ally",
    apply: async ({ actor, target }) => {
      if (!target) return;
      const hp = await healHP(target, "20 + 2d20");
      const morale = await healMorale(target, "10 + 3d20");
      await clearChannelledMagic(actor);
      await postChat(actor, "W4SQ.ChatRevify", { name: actor.name ?? "", target: target.name ?? "", hp, morale });
    }
  },
  fireAspect: {
    name: "Fire Aspect",
    category: "specialist",
    specialistType: "mage",
    difficulty: "hard",
    cooldown: 4,
    target: "ally",
    apply: async ({ actor, target }) => {
      if (!target) return;
      await addEffect(target, E({ tnDice: "+4d10", dmgDice: "+3d20", defSoakDice: "+1d20", tags: { fireAspect: true } }, 2, `fire-aspect-${randomID()}`, game.i18n.localize("W4SQ.ManeuverFireAspect")));
      await clearChannelledMagic(actor);
      await postChat(actor, "W4SQ.ChatFireAspect", { name: actor.name ?? "", target: target.name ?? "" });
    }
  },

  lineDefense: {
    name: "Line Defense",
    category: "specialist",
    specialistType: "engineer",
    difficulty: "average",
    cooldown: 2,
    target: "none",
    apply: async ({ actor }) => {
      await requestZonePlacement(actor, "lineDefense");
      await postChat(actor, "W4SQ.ChatLineDefense", { name: actor.name ?? "" });
    }
  },
  minefield: {
    name: "Minefield",
    category: "specialist",
    specialistType: "engineer",
    difficulty: "hard",
    cooldown: 2,
    target: "none",
    apply: async ({ actor }) => {
      await requestZonePlacement(actor, "minefield");
      await postChat(actor, "W4SQ.ChatMinefieldDeploy", { name: actor.name ?? "" });
    }
  },
  wolfPits: {
    name: "Wolf Pits",
    category: "specialist",
    specialistType: "engineer",
    difficulty: "average",
    cooldown: 2,
    target: "none",
    apply: async ({ actor }) => {
      await requestZonePlacement(actor, "wolfPits");
      await postChat(actor, "W4SQ.ChatWolfPitsDeploy", { name: actor.name ?? "" });
    }
  },
  flashbombs: {
    name: "Flashbombs",
    category: "specialist",
    specialistType: "engineer",
    difficulty: "hard",
    cooldown: 2,
    target: "enemy",
    apply: async ({ actor, target }) => {
      if (!target) return;
      await addEffect(target, E({ tnDice: "-50 - 5d10", tags: { disorganized: true } }, 2, `flashbomb-${randomID()}`, game.i18n.localize("W4SQ.ManeuverFlashbombs")));
      await postChat(actor, "W4SQ.ChatFlashbombs", { name: actor.name ?? "", target: target.name ?? "" });
    }
  },
  fortifyPosition: {
    name: "Fortify Position",
    category: "specialist",
    specialistType: "engineer",
    difficulty: "hard",
    cooldown: 2,
    target: "self",
    apply: async ({ actor }) => {
      await requestZonePlacement(actor, "fortifyPosition");
      await postChat(actor, "W4SQ.ChatFortify", { name: actor.name ?? "" });
    }
  },
  ballisticCalibration: {
    name: "Ballistic Calibration",
    category: "specialist",
    specialistType: "engineer",
    difficulty: "average",
    cooldown: 2,
    target: "ally",
    apply: async ({ actor, target }) => {
      if (!target) return;
      await addEffect(target, E({ tnDice: "+5d10" }, 6, `calibration-${randomID()}`, game.i18n.localize("W4SQ.ManeuverCalibration")));
      await postChat(actor, "W4SQ.ChatCalibration", { name: actor.name ?? "", target: target.name ?? "" });
    }
  }
};

export function maneuversFor(actor) {
  const role = actor.getFlag(FLAG_SCOPE, "role") || "infantry";
  const weaponFlag = actor.getFlag(FLAG_SCOPE, "weapon") || "sword";
  const weapon = role === "specialist" ? null : weaponFlag;
  return Object.entries(MANEUVERS)
    .filter(([_, m]) => {
      if (m.category === "universal") return !m.roles || m.roles.includes(role);
      if (m.category === "weapon") return m.weaponType === weapon;
      if (m.category === "hybrid") return role === "hybrid";
      if (m.category === "mounted") return role === "mounted";
      if (m.category === "specialist") {
        if (role !== "specialist") return false;
        if (m.specialistType === "mage") return isMage(actor);
        if (m.specialistType === "engineer") return isEngineer(actor);
        return true;
      }
      return false;
    })
    .map(([key, data]) => ({ key, ...data }));
}

export async function onManeuverFail(actor, maneuver = null) {
  const effect = {
    key: "fail-disorg",
    label: "Disorganized (Failed Maneuver)",
    duration: 1,
    mods: { tags: { disorganized: true } }
  };
  const list = actor.getFlag(FLAG_SCOPE, "effects") ?? [];
  list.push(effect);
  await actor.setFlag(FLAG_SCOPE, "effects", list);
  if (maneuver?.category === "specialist") {
    if (maneuver.specialistType === "mage") {
      if (maneuver.key === "channelMagic") {
        await triggerMinorPeril(actor);
        await clearChannelledMagic(actor);
      } else {
        await triggerMajorPeril(actor, { maneuverKey: maneuver?.key ?? null, result: "fail" });
        await clearChannelledMagic(actor);
      }
    } else if (maneuver.specialistType === "engineer") {
      await triggerEngineerMishap(actor);
    }
  }
}

export function friendlyTokensNear(actor, distance = 5) {
  const tokens = actor?.getActiveTokens(true) ?? [];
  if (!tokens.length) return [];
  const origin = tokens[0];
  if (!origin) return [];
  const placeables = canvas?.tokens?.placeables ?? [];
  const originCenter = { x: origin.x + origin.width / 2, y: origin.y + origin.height / 2 };
  return placeables.filter(token => {
    if (token === origin) return false;
    if (token.document?.disposition !== origin.document?.disposition) return false;
    const tokenCenter = { x: token.x + token.width / 2, y: token.y + token.height / 2 };
    const dist = canvas?.grid?.measureDistance
      ? canvas.grid.measureDistance(originCenter, tokenCenter)
      : Math.hypot(tokenCenter.x - originCenter.x, tokenCenter.y - originCenter.y);
    return dist <= distance;
  });
}

function removeTagEffects(actor, tag) {
  const effects = getEffects(actor).filter(effect => !effect?.mods?.tags?.[tag]);
  return actor.setFlag(FLAG_SCOPE, "effects", effects);
}

MANEUVERS.trample = {
  name: "Trample",
  category: "mounted",
  difficulty: "average",
  duration: 1,
  target: "enemy",
  apply: async ({ actor, target }) => {
    if (!target) return;
    const hpRoll = await (new Roll("1d10").roll({ async: true }));
    const moraleRoll = await (new Roll("1d20").roll({ async: true }));
    const hp = Number(target.getFlag(FLAG_SCOPE, "hp") || 0);
    const hpMax = Number(target.getFlag(FLAG_SCOPE, "hpMax") || 0);
    const morale = Number(target.getFlag(FLAG_SCOPE, "morale") || 0);
    const moraleMax = Number(target.getFlag(FLAG_SCOPE, "moraleMax") || 0);
    await target.setFlag(FLAG_SCOPE, "hp", Math.max(0, hp - hpRoll.total));
    await target.setFlag(FLAG_SCOPE, "morale", Math.max(0, morale - moraleRoll.total));
    await addEffect(target, E({ defPenaltyDice: "-1d20", tags: { looseFormation: true } }, 1, "trample-loose", "Loose Formation"));
    await addEffect(actor, E({ tags: { disorganized: true } }, 1, "trample-self", "Trample Exhaustion"));
  }
};

MANEUVERS.wheelAbout = {
  name: "Wheel About",
  category: "mounted",
  difficulty: "average",
  duration: 1,
  target: "self",
  apply: async ({ actor }) => {
    await removeTagEffects(actor, "flanked");
    await addEffect(actor, E({ defSoakDice: "+1d20" }, 1, "wheel", "Wheel About"));
  }
};

MANEUVERS.breakthrough = {
  name: "Breakthrough",
  category: "mounted",
  difficulty: "hard",
  target: "self",
  apply: async ({ actor }) => {
    await clearNegative(actor);
    await removeDisorganized(actor);
    for (const token of friendlyTokensNear(actor)) {
      const ally = token.actor;
      if (!ally) continue;
      await clearNegative(ally);
      await removeDisorganized(ally);
    }
    const moraleRoll = await (new Roll("2d20").roll({ async: true }));
    const morale = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
    const moraleMax = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 0);
    await actor.setFlag(FLAG_SCOPE, "morale", Math.min(moraleMax, morale + moraleRoll.total));
    const content = game.i18n.format("W4SQ.ChatManeuverBreakthrough", { value: moraleRoll.total, name: actor.name ?? "" });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${content}</p>`
    });
  }
};
