import { FLAG_SCOPE } from "../config.js";
import { addEffect, removeEffectByKey, ensureEffect, actorHasTag, getEffects, removeDisorganized } from "./effects.js";
import {
  applyChaosMutationAttack,
  applyChaosMutationDefense,
  applyChaosDamageTaken,
  handleChaosPostHit,
  ensureChaosMutation,
  applyChaosRegeneration,
  mutationLabel
} from "../passives/chaos.js";
import { maybeTriggerHoB } from "./hob.js";

const { randomID } = foundry.utils;

const ORIGINS = ["human", "dwarf", "elf", "monster", "greenskin", "ratmen", "undead", "chaos"];

const ORIGIN_PASSIVES = {
  human: [
    "humanBattleDrill",
    "humanResilient",
    "humanAdaptive",
    "humanWellEquipped",
    "humanToTheBitterEnd"
  ],
  dwarf: [
    "dwarfIronWill",
    "dwarfMastercraftedArmor",
    "dwarfAncestralGrudge",
    "dwarfGrudgin",
    "dwarfStalwart"
  ],
  elf: [
    "elfElvenGrace",
    "elfSwift",
    "elfSuperiorReflexes",
    "elfElvenWeaponry",
    "elfAestheticPerfection"
  ],
  monster: [
    "monsterBulky",
    "monsterRegeneration",
    "monsterThickHide",
    "monsterPredatorInstinct",
    "monsterLurker",
    "monsterMultipleAppendages",
    "monsterHorrorIncarnate",
    "monsterColossal",
    "monsterDevourer",
    "monsterMonstrousCharge"
  ],
  greenskin: [
    "greenSurge",
    "greenMobMentality",
    "greenGobbos",
    "greenBigChoppas",
    "greenUnstoppableWave"
  ],
  ratmen: [
    "ratCoward",
    "ratPoisoner",
    "ratMuskOfFear",
    "ratTreacherous",
    "ratNumerous"
  ],
  undead: [
    "undeadPuppet",
    "undeadLifeDrain",
    "undeadRegeneration",
    "undeadEthereal",
    "undeadMarchOfTheDead"
  ],
  chaos: [
    "chaosMutation",
    "chaosDaemonic",
    "chaosCorruptive",
    "chaosFrenzy",
    "chaosForged"
  ]
};

const ALL_PASSIVE_KEYS = Object.values(ORIGIN_PASSIVES).flat();

const PASSIVE_LABELS = {
  humanBattleDrill: "W4SQ.PassiveHumanBattleDrill",
  humanResilient: "W4SQ.PassiveHumanResilient",
  humanAdaptive: "W4SQ.PassiveHumanAdaptive",
  humanWellEquipped: "W4SQ.PassiveHumanWellEquipped",
  humanToTheBitterEnd: "W4SQ.PassiveHumanToTheBitterEnd",

  dwarfIronWill: "W4SQ.PassiveDwarfIronWill",
  dwarfMastercraftedArmor: "W4SQ.PassiveDwarfMastercraftedArmor",
  dwarfAncestralGrudge: "W4SQ.PassiveDwarfAncestralGrudge",
  dwarfGrudgin: "W4SQ.PassiveDwarfGrudgin",
  dwarfStalwart: "W4SQ.PassiveDwarfStalwart",

  elfElvenGrace: "W4SQ.PassiveElfElvenGrace",
  elfSwift: "W4SQ.PassiveElfSwift",
  elfSuperiorReflexes: "W4SQ.PassiveElfSuperiorReflexes",
  elfElvenWeaponry: "W4SQ.PassiveElfElvenWeaponry",
  elfAestheticPerfection: "W4SQ.PassiveElfAestheticPerfection",

  monsterBulky: "W4SQ.PassiveMonsterBulky",
  monsterRegeneration: "W4SQ.PassiveMonsterRegeneration",
  monsterThickHide: "W4SQ.PassiveMonsterThickHide",
  monsterPredatorInstinct: "W4SQ.PassiveMonsterPredatorInstinct",
  monsterLurker: "W4SQ.PassiveMonsterLurker",
  monsterMultipleAppendages: "W4SQ.PassiveMonsterMultipleAppendages",
  monsterHorrorIncarnate: "W4SQ.PassiveMonsterHorrorIncarnate",
  monsterColossal: "W4SQ.PassiveMonsterColossal",
  monsterDevourer: "W4SQ.PassiveMonsterDevourer",
  monsterMonstrousCharge: "W4SQ.PassiveMonsterMonstrousCharge",

  greenSurge: "W4SQ.PassiveGreenSurge",
  greenMobMentality: "W4SQ.PassiveGreenMobMentality",
  greenGobbos: "W4SQ.PassiveGreenGobbos",
  greenBigChoppas: "W4SQ.PassiveGreenBigChoppas",
  greenUnstoppableWave: "W4SQ.PassiveGreenUnstoppableWave",

  ratCoward: "W4SQ.PassiveRatCoward",
  ratPoisoner: "W4SQ.PassiveRatPoisoner",
  ratMuskOfFear: "W4SQ.PassiveRatMuskOfFear",
  ratTreacherous: "W4SQ.PassiveRatTreacherous",
  ratNumerous: "W4SQ.PassiveRatNumerous",

  undeadPuppet: "W4SQ.PassiveUndeadPuppet",
  undeadLifeDrain: "W4SQ.PassiveUndeadLifeDrain",
  undeadRegeneration: "W4SQ.PassiveUndeadRegeneration",
  undeadEthereal: "W4SQ.PassiveUndeadEthereal",
  undeadMarchOfTheDead: "W4SQ.PassiveUndeadMarchOfTheDead",

  chaosMutation: "W4SQ.PassiveChaosMutation",
  chaosDaemonic: "W4SQ.PassiveChaosDaemonic",
  chaosCorruptive: "W4SQ.PassiveChaosCorruptive",
  chaosFrenzy: "W4SQ.PassiveChaosFrenzy",
  chaosForged: "W4SQ.PassiveChaosForged"
};

const escapeHtml = foundry.utils?.escapeHTML ?? (str => String(str ?? ""));

function safeName(entity) {
  if (!entity) {
    return escapeHtml(game.i18n.localize("W4SQ.UnknownSquad"));
  }
  const raw = typeof entity === "string" ? entity : entity.name;
  return escapeHtml(raw || game.i18n.localize("W4SQ.UnknownSquad"));
}

async function sendPassiveMessage(actor, key, data = {}) {
  if (!actor || !key) return null;
  const formatted = game.i18n.format(key, data);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${formatted}</p>`
  });
}

export function getOrigin(actor) {
  if (!actor) return null;
  const flagOrigin = actor.getFlag?.(FLAG_SCOPE, "origin");
  if (typeof flagOrigin === "string" && ORIGINS.includes(flagOrigin)) return flagOrigin;
  const origin = foundry.utils.getProperty(actor.system ?? actor.data?.data, "squad.origin");
  if (typeof origin === "string" && ORIGINS.includes(origin)) return origin;
  return null;
}

export function getPassives(actor) {
  const flagPassives = actor.getFlag?.(FLAG_SCOPE, "passives");
  const source = (flagPassives && typeof flagPassives === "object")
    ? flagPassives
    : (foundry.utils.getProperty(actor.system ?? actor.data?.data, "squad.passives") || {});
  const result = {};
  for (const key of ALL_PASSIVE_KEYS) {
    result[key] = Boolean(source[key]);
  }
  return result;
}

export function getOriginPassivesFor(origin) {
  return ORIGIN_PASSIVES[origin] ?? [];
}

export const ORIGIN_KEYS = ORIGINS;

export function getOriginLabelKey(origin) {
  switch (origin) {
    case "human": return "W4SQ.OriginHuman";
    case "dwarf": return "W4SQ.OriginDwarf";
    case "elf": return "W4SQ.OriginElf";
    case "monster": return "W4SQ.OriginMonster";
    case "greenskin": return "W4SQ.OriginGreenskin";
    case "ratmen": return "W4SQ.OriginRatmen";
    case "undead": return "W4SQ.OriginUndead";
    case "chaos": return "W4SQ.OriginChaos";
    default: return "";
  }
}

export function buildDefaultPassives(origin) {
  const passives = {};
  for (const key of ALL_PASSIVE_KEYS) {
    passives[key] = false;
  }
  if (origin && ORIGIN_PASSIVES[origin]) {
    for (const key of ORIGIN_PASSIVES[origin]) {
      passives[key] = Boolean(passives[key]);
    }
  }
  return passives;
}

export function relevantPassives(origin, actor) {
  const base = ORIGIN_PASSIVES[origin] ?? [];
  if (!base.length) return [];
  const passives = getPassives(actor);
  return base.map(key => ({
    key,
    label: PASSIVE_LABELS[key] ?? key,
    active: Boolean(passives[key])
  }));
}

export function getPassiveLabel(key) {
  return PASSIVE_LABELS[key] ?? key;
}

function getNumberFlag(actor, key) {
  return Number(actor?.getFlag(FLAG_SCOPE, key) || 0);
}

function sceneActors() {
  const placeables = canvas?.tokens?.placeables ?? [];
  const set = new Set();
  for (const token of placeables) {
    if (token?.actor) set.add(token.actor);
  }
  if (!set.size && game.combat) {
    for (const combatant of game.combat.combatants ?? []) {
      if (combatant?.actor) set.add(combatant.actor);
    }
  }
  return [...set];
}

export function hasUndeadMaster(actor) {
  const actors = sceneActors();
  for (const candidate of actors) {
    if (!candidate || candidate === actor) continue;
    if (getOrigin(candidate) !== "undead") continue;
    const passives = getPassives(candidate);
    if (isUndeadPuppet(candidate, passives)) continue;
    if (!sameSide(actor, candidate)) continue;
    if (getNumberFlag(candidate, "morale") > 0) return true;
  }
  return false;
}

export function isUndeadPuppet(actor, passives = null) {
  if (!actor) return false;
  if (getOrigin(actor) !== "undead") return false;
  const p = passives ?? getPassives(actor);
  return Boolean(p.undeadPuppet);
}

function dispositionOf(actor) {
  if (!actor) return CONST.TOKEN_DISPOSITIONS.NEUTRAL;
  const active = actor.getActiveTokens?.(true) ?? [];
  if (active.length) {
    return active[0]?.document?.disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;
  }
  for (const token of canvas?.tokens?.placeables ?? []) {
    if (token.actor === actor) {
      return token.document?.disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;
    }
  }
  return CONST.TOKEN_DISPOSITIONS.NEUTRAL;
}

function sameSide(a, b) {
  return dispositionOf(a) === dispositionOf(b);
}

function clampNonNegative(value) {
  return Math.max(0, Number.isFinite(value) ? value : 0);
}

function hpRatio(actor) {
  const hp = Number(actor?.getFlag(FLAG_SCOPE, "hp") || 0);
  const hpMax = Number(actor?.getFlag(FLAG_SCOPE, "hpMax") || 0);
  if (hpMax <= 0) return 0;
  return Math.max(0, Math.min(1, hp / hpMax));
}

function moraleRatio(actor) {
  const morale = Number(actor?.getFlag(FLAG_SCOPE, "morale") || 0);
  const moraleMax = Number(actor?.getFlag(FLAG_SCOPE, "moraleMax") || 0);
  if (moraleMax <= 0) return 0;
  return Math.max(0, Math.min(1, morale / moraleMax));
}

function armyHpRatio(actor) {
  if (!actor) return 0;
  const disposition = dispositionOf(actor);
  const tokens = canvas?.tokens?.placeables ?? [];
  let total = 0;
  let max = 0;
  for (const token of tokens) {
    const tokActor = token?.actor;
    if (!tokActor) continue;
    if (dispositionOf(tokActor) !== disposition) continue;
    const hp = Number(tokActor.getFlag(FLAG_SCOPE, "hp") || 0);
    const hpMax = Number(tokActor.getFlag(FLAG_SCOPE, "hpMax") || 0);
    total += Math.max(0, hp);
    max += Math.max(0, hpMax);
  }
  if (max <= 0) {
    return hpRatio(actor);
  }
  return Math.max(0, Math.min(1, total / max));
}

function ensureNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function getRoundSignature() {
  const round = Number(game.combat?.round ?? 0);
  const turn = Number(game.combat?.turn ?? 0);
  const combatId = game.combat?.id ?? game.combat?._id ?? "";
  return { round, turn, combatId };
}

function addMoraleBonus(current, delta) {
  return clampNonNegative(ensureNumber(current) + ensureNumber(delta));
}

async function applyArmorPierce(damage, pierceBonus) {
  const pierce = clampNonNegative(pierceBonus);
  if (!pierce) return clampNonNegative(damage);
  return clampNonNegative(ensureNumber(damage) + pierce);
}

function ensureFlagObject(actor, key, defaultValue = {}) {
  const current = actor.getFlag(FLAG_SCOPE, key);
  if (current && typeof current === "object") return { ...current };
  return { ...defaultValue };
}

export async function adjustAttackTN(actor, opponent, { tn, action, isManeuver = false, maneuverKey = null, isCharge = false } = {}) {
  let next = Number(tn) || 0;
  const origin = getOrigin(actor);
  const passives = getPassives(actor);
  const hp = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
  const hpMax = Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 0);
  const ratio = hpMax > 0 ? hp / hpMax : 0;
  const { round } = getRoundSignature();

  const add = value => { next += Number(value) || 0; };

  if (origin === "monster") {
    // No base TN modifier, handled by passives.
  }
  if (origin === "undead" && passives.undeadPuppet) add(-10);
  if (origin === "greenskin" && passives.greenGobbos) add(-10);
  if (origin === "greenskin" && passives.greenUnstoppableWave) add(-20);
  if (origin === "monster" && passives.monsterBulky) add(-10);
  if (origin === "monster" && passives.monsterHorrorIncarnate) add(-20);
  if (origin === "monster" && passives.monsterMultipleAppendages) add(-20);
  if (origin === "monster" && passives.monsterMonstrousCharge) add(-10);
  if (origin === "elf" && passives.elfElvenGrace) add(10);
  if (origin === "chaos" && passives.chaosFrenzy) {
    const lostRatio = 1 - Math.max(0, Math.min(1, ratio));
    const steps = Math.max(0, Math.floor(lostRatio / 0.1));
    add(steps * (7 + 5));
  }
  if (origin === "dwarf" && passives.dwarfGrudgin) {
    const ticks = Number(actor.getFlag(FLAG_SCOPE, "dwarfGrudgeTicks") || 0);
    add(Math.min(4, Math.max(0, ticks)) * 5);
  }
  if (origin === "greenskin" && passives.greenSurge) {
    const surgeActive = Boolean(actor.getFlag(FLAG_SCOPE, "greenSurgeActive"));
    if (surgeActive) add(10);
  }
  if (passives.ratTreacherous) {
    const buff = actor.getFlag(FLAG_SCOPE, "ratTreacherousBuff");
    if (buff?.remaining > 0) add(40);
  }
  if (origin === "ratmen" && passives.ratTreacherous && opponent && sameSide(actor, opponent)) {
    add(40);
  }
  if (isManeuver) {
    if (origin === "human" && passives.humanBattleDrill) add(10);
    if (origin === "human" && passives.humanAdaptive && ratio < 0.5) add(10);
    if (origin === "elf" && passives.elfElvenGrace) add(10);
    if (origin === "chaos" && passives.chaosFrenzy) {
      const lostRatio = 1 - Math.max(0, Math.min(1, ratio));
      const steps = Math.max(0, Math.floor(lostRatio / 0.1));
      add(steps * (7 + 5));
    }
    if (origin === "dwarf" && passives.dwarfGrudgin) {
      const ticks = Number(actor.getFlag(FLAG_SCOPE, "dwarfGrudgeTicks") || 0);
      add(Math.min(4, Math.max(0, ticks)) * 5);
    }
    if (origin === "elf" && passives.elfSwift) {
      if (await actor.getFlag(FLAG_SCOPE, "elfSwiftReady")) {
        add(20);
        await actor.setFlag(FLAG_SCOPE, "elfSwiftReady", false);
      }
    }
    if (origin === "ratmen" && maneuverKey === "flank") {
      add(10);
    }
  }

  if (origin === "chaos" && passives.chaosMutation) {
    await ensureChaosMutation(actor);
    const adjusted = await applyChaosMutationAttack(actor, { attackTN: next });
    if (Number.isFinite(adjusted?.attackTN)) next = adjusted.attackTN;
  }

  return next;
}

export async function adjustManeuverTN(actor, opponent, context = {}) {
  return adjustAttackTN(actor, opponent, { ...context, isManeuver: true });
}

export async function adjustChipDamage(actor, chip, { action } = {}) {
  const origin = getOrigin(actor);
  const passives = getPassives(actor);
  let total = Number(chip?.total ?? chip ?? 0);
  if (origin === "monster" && passives.monsterMultipleAppendages && action === "melee") {
    const extra = await new Roll("1d10").evaluate({});
    total += extra.total;
    return { total, formula: `${chip?.formula || "1d10"} + ${extra.formula}` };
  }
  return { total, formula: chip?.formula ?? "1d10" };
}

function defenderHasBraced(defenseTags) {
  if (!defenseTags) return false;
  return Boolean(defenseTags.braced);
}

export async function adjustDefenseSoak(defender, attacker, context = {}) {
  let { defenseOnly = 0, armor = 0, rangedResist = 0, action = "melee", defenseTags = {} } = context;
  const origin = getOrigin(defender);
  const passives = getPassives(defender);
  const attackerOrigin = getOrigin(attacker);
  const attackerPassives = getPassives(attacker);

  if (origin === "human" && passives.humanWellEquipped) {
    armor += 5;
  }
  if (origin === "dwarf" && passives.dwarfMastercraftedArmor) {
    armor += 10;
  }
  if (origin === "dwarf" && passives.dwarfStalwart && defenderHasBraced(defenseTags)) {
    armor += 10;
  }
  if (origin === "chaos" && passives.chaosForged) {
    armor += 10;
  }
  if (origin === "monster" && passives.monsterThickHide) {
    const roll = await new Roll("3d10+5").evaluate({});
    armor += roll.total;
    await sendPassiveMessage(defender, "W4SQ.PassiveMsgMonsterThickHide", {
      name: safeName(defender),
      amount: roll.total
    });
  }
  if (attackerOrigin === "monster" && attackerPassives.monsterLurker && action === "melee") {
    const penalty = await new Roll("1d20").evaluate({});
    defenseOnly = Math.max(0, defenseOnly - penalty.total);
  }

  return { defenseOnly, armor, rangedResist };
}

export async function adjustAttackDamage(actor, defender, context = {}) {
  const origin = getOrigin(actor);
  const passives = getPassives(actor);
  const defenderOrigin = getOrigin(defender);
  const defenderPassives = getPassives(defender);
  const {
    action = "melee",
    damageType = action,
    isMagical = false,
    isCharge = false,
    hpDamage = 0
  } = context;
  const hp = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
  const hpMax = Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 0);
  const moraleRatioTarget = moraleRatio(defender);
  const actorName = safeName(actor);
  const defenderName = safeName(defender);

  let damage = Number(hpDamage) || 0;
  let moraleBonus = 0;
  let armorPierceBonus = 0;
  let extraAttacks = 0;

  if (origin === "chaos") {
    await ensureChaosMutation(actor);
    damage += 10;
    moraleBonus += 10;
    if (passives.chaosDaemonic) {
      damage += 5;
      moraleBonus += 20;
    }
    if (passives.chaosForged) {
      moraleBonus += 10;
    }
    if (passives.chaosMutation) {
      const adjusted = await applyChaosMutationAttack(actor, {});
      if (Number.isFinite(adjusted?.damageBonus)) damage += adjusted.damageBonus;
      if (Number.isFinite(adjusted?.armorPierceBonus)) armorPierceBonus += adjusted.armorPierceBonus;
      if (adjusted?.applyFlanked) actorHasTag(defender, "flanked") || await ensureEffect(defender, {
        key: randomID?.() ?? `chaos-flank-${Date.now()}`,
        label: game.i18n.localize("W4SQ.MutationDancingShadows"),
        duration: 2,
        mods: { tags: { flanked: true } }
      }, eff => Boolean(eff?.mods?.tags?.flanked));
      if (Number.isFinite(adjusted?.damageVsFlanked) && actorHasTag(defender, "flanked")) {
        damage += adjusted.damageVsFlanked;
      }
      if (Number.isFinite(adjusted?.chargeMorale) && isCharge) {
        moraleBonus += adjusted.chargeMorale;
      }
    }
  }

  if (origin === "elf") {
    damage += 10;
    if (passives.elfElvenWeaponry) damage += 10;
  }
  if (origin === "monster") {
    moraleBonus += 10;
    if (passives.monsterBulky) damage += 10;
    if (passives.monsterHorrorIncarnate) moraleBonus += 40;
    if (passives.monsterPredatorInstinct && moraleRatioTarget < 0.5) {
      moraleBonus += 30;
      await sendPassiveMessage(actor, "W4SQ.PassiveMsgMonsterPredatorInstinctStrike", {
        name: actorName,
        target: defenderName,
        amount: 30
      });
    }
    if (passives.monsterColossal) damage += 30;
    if (passives.monsterMonstrousCharge && isCharge) {
      const chargeBonus = await new Roll("1d20").evaluate({});
      damage += chargeBonus.total;
      await sendPassiveMessage(actor, "W4SQ.PassiveMsgMonsterMonstrousCharge", {
        name: actorName,
        amount: chargeBonus.total
      });
    }
    if (passives.monsterMultipleAppendages && action === "melee") {
      extraAttacks += 1;
    }
  }
  if (origin === "greenskin") {
    if (hpMax > 0 && hp / hpMax > 0.5) {
      damage += 10;
      await sendPassiveMessage(actor, "W4SQ.PassiveMsgGreenskinOrigin", {
        name: actorName,
        amount: 10
      });
    }
    if (passives.greenSurge && actor.getFlag(FLAG_SCOPE, "greenSurgeActive")) {
      damage += 20;
      await sendPassiveMessage(actor, "W4SQ.PassiveMsgGreenSurge", {
        name: actorName,
        amount: 20
      });
    }
    if (passives.greenUnstoppableWave && isCharge) moraleBonus += 40;
    if (passives.greenBigChoppas) armorPierceBonus += 10;
  }
  if (origin === "undead") {
    if (passives.undeadPuppet) {
      damage = Math.max(0, damage - 10);
      moraleBonus = Math.max(0, moraleBonus - 10);
      if (hasUndeadMaster(actor)) {
        damage += 5;
        moraleBonus += 5;
        await sendPassiveMessage(actor, "W4SQ.PassiveMsgUndeadPuppetMaster", {
          name: actorName
        });
      }
    }
    if (passives.undeadEthereal) {
      moraleBonus += 20;
      const bypass = Math.floor(damage * 0.25);
      if (bypass > 0) {
        damage = Math.max(0, damage - bypass);
        armorPierceBonus += bypass;
      }
    }
  }
  if (origin === "human" && passives.humanResilient) {
    // Attack bonus not applicable
  }
  if (origin === "dwarf" && passives.dwarfAncestralGrudge) {
    if (defenderOrigin === "greenskin" || defenderOrigin === "ratmen") {
      damage += 20;
      await sendPassiveMessage(actor, "W4SQ.PassiveMsgDwarfAncestralGrudge", {
        name: actorName,
        target: defenderName,
        amount: 20
      });
    }
  }
  if (origin === "ratmen" && passives.ratTreacherous) {
    const buff = actor.getFlag(FLAG_SCOPE, "ratTreacherousBuff");
    if (buff?.remaining > 0) damage += 10;
  }
  if (origin === "ratmen" && passives.ratTreacherous && defender && sameSide(actor, defender)) {
    await actor.setFlag(FLAG_SCOPE, "ratTreacherousBuff", {
      remaining: 2,
      round: getRoundSignature().round
    });
    damage += 10;
  }
  if (origin === "ratmen" && passives.ratNumerous) {
    moraleBonus += 10; // overwhelmed baseline
  }
  if (origin === "monster" && passives.monsterDevourer && defender && sameSide(actor, defender)) {
    const heal = await new Roll("3d10+20").evaluate({});
    const hpCurrent = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
    const hpMax = Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 0);
    const next = Math.min(hpMax, hpCurrent + heal.total);
    await actor.setFlag(FLAG_SCOPE, "hp", next);
    await sendPassiveMessage(actor, "W4SQ.PassiveMsgMonsterDevourer", {
      name: actorName,
      amount: heal.total
    });
  }
  if (origin === "greenskin" && passives.greenMobMentality) {
    const buff = actor.getFlag(FLAG_SCOPE, "greenMobBonus");
    if (buff?.remaining > 0) {
      const roll = await new Roll("4d10+10").evaluate({});
      moraleBonus += roll.total;
    }
  }
  if (origin === "ratmen" && passives.ratNumerous) {
    moraleBonus += 10;
  }
  if (origin === "ratmen" && passives.ratTreacherous && defender && sameSide(actor, defender)) {
    await sendPassiveMessage(actor, "W4SQ.PassiveMsgRatTreacherous", {
      name: actorName,
      target: defenderName,
      amount: 10
    });
  }

  return { damage, moraleBonus, armorPierceBonus, extraAttacks };
}

export async function adjustIncomingDamage(defender, attacker, context = {}) {
  let { damage = 0, moraleBonus = 0, action = "melee", damageType = action, isMagical = false, isAoE = false, isCharge = false } = context;
  const origin = getOrigin(defender);
  const passives = getPassives(defender);
  const attackerOrigin = getOrigin(attacker);
  const attackerPassives = getPassives(attacker);
  const ratio = hpRatio(defender);
  const armyRatio = origin === "ratmen" && passives.ratMuskOfFear ? armyHpRatio(defender) : ratio;

  const reduceFlat = amount => {
    damage = clampNonNegative(damage - amount);
    moraleBonus = clampNonNegative(moraleBonus - amount);
  };

  if (origin === "human") {
    reduceFlat(5);
    if (passives.humanResilient) reduceFlat(5);
  }
  if (origin === "dwarf" && isMagical) {
    damage = Math.floor(damage * 0.75);
    moraleBonus = Math.floor(moraleBonus * 0.75);
  }
  if (origin === "chaos") {
    if (passives.chaosMutation) {
      const adjusted = applyChaosMutationDefense(defender, { damage, moraleBonus });
      if (Number.isFinite(adjusted?.incomingMultiplier)) {
        damage = Math.floor(damage * adjusted.incomingMultiplier);
        moraleBonus = Math.floor(moraleBonus * adjusted.incomingMultiplier);
      }
      if (Number.isFinite(adjusted?.armorBonus)) {
        damage = Math.max(0, damage - adjusted.armorBonus);
      }
    }
  }
  if (origin === "dwarf" && passives.dwarfIronWill) {
    moraleBonus = clampNonNegative(moraleBonus - 20);
  }
  if (origin === "elf" && passives.elfSuperiorReflexes) {
    if (damageType === "melee") {
      damage = clampNonNegative(damage - 10);
    } else if (damageType === "ranged") {
      damage = clampNonNegative(damage - 5);
    }
  }
  if (origin === "undead") {
    moraleBonus = clampNonNegative(moraleBonus - 10);
    if (passives.undeadPuppet) {
      const extra = await new Roll("20+3d10").evaluate({});
      damage += extra.total;
      moraleBonus += extra.total;
      await sendPassiveMessage(defender, "W4SQ.PassiveMsgUndeadPuppetFragile", {
        name: safeName(defender),
        amount: extra.total
      });
      if (hasUndeadMaster(defender)) {
        moraleBonus = clampNonNegative(moraleBonus - 10);
      }
    }
    if (passives.undeadEthereal && !isMagical) {
      damage = Math.floor(damage * 0.5);
    }
  }
  if (origin === "monster") {
    if (passives.monsterPredatorInstinct) {
      damage += 20;
      await sendPassiveMessage(defender, "W4SQ.PassiveMsgMonsterPredatorInstinctExpose", {
        name: safeName(defender),
        amount: 20
      });
    }
    if (passives.monsterColossal && damageType === "ranged") {
      damage += 30;
    }
    if (passives.monsterMonstrousCharge) {
      damage += 30;
    }
    damage = Math.floor(damage * 0.8);
    moraleBonus = Math.floor(moraleBonus * 0.8);
  }
  if (origin === "greenskin" && passives.greenMobMentality) {
    if (ratio > 0.5) {
      moraleBonus = Math.floor(moraleBonus / 2);
    }
  }
  if (origin === "greenskin" && passives.greenGobbos) {
    damage += 20;
  }
  if (origin === "ratmen") {
    moraleBonus += 5;
    if (passives.ratCoward) {
      moraleBonus += 20;
      if (actorHasTag(defender, "flanked")) damage += 20;
    }
    if (passives.ratMuskOfFear) {
      if (armyRatio > 0.5) {
        moraleBonus = Math.floor(moraleBonus * 0.75);
      } else {
        moraleBonus = Math.floor(moraleBonus * 1.5);
      }
    }
    if (passives.ratNumerous && (isAoE || damageType === "artillery")) {
      damage += 40;
    }
  }
  if (attackerOrigin === "monster" && attackerPassives.monsterHorrorIncarnate) {
    moraleBonus += 40;
  }
  const corrupted = getEffects(defender).find(eff => eff?.mods?.tags?.chaosCorruptedStacks);
  if (corrupted) {
    const stacks = Number(corrupted.mods.tags.chaosCorruptedStacks) || 0;
    moraleBonus += stacks * 5;
  }
  if (actorHasTag(defender, "overwhelmed")) {
    moraleBonus += 10;
  }

  return { damage: clampNonNegative(damage), moraleBonus: clampNonNegative(moraleBonus) };
}

export async function applyPostAttackEffects({ attacker, defender, success, action, isMagical = false, hpDamage = 0 } = {}) {
  if (!success || !defender) return;
  const origin = getOrigin(attacker);
  const passives = getPassives(attacker);
  const defenderPassives = getPassives(defender);
  const targetIsPuppet = isUndeadPuppet(defender, defenderPassives);

  if (origin === "ratmen" && passives.ratPoisoner) {
    const alreadyPoisoned = actorHasTag(defender, "ratPoison");
    await ensureEffect(defender, {
      key: randomID?.() ?? `rat-poison-${Date.now()}`,
      label: game.i18n.localize("W4SQ.PassiveRatPoisoner"),
      duration: 2,
      mods: { tags: { ratPoison: true }, tnDice: "-20" }
    }, eff => Boolean(eff?.mods?.tags?.ratPoison));
    if (!alreadyPoisoned) {
      await sendPassiveMessage(attacker, "W4SQ.PassiveMsgRatPoisoner", {
        name: safeName(attacker),
        target: safeName(defender)
      });
    }
  }
  if (origin === "chaos") {
    if (passives.chaosCorruptive) {
      const existing = getEffects(defender).find(eff => eff?.mods?.tags?.chaosCorrupted);
      const stacks = Math.min(5, Number(existing?.mods?.tags?.chaosCorruptedStacks || 0) + 1);
      await ensureEffect(defender, {
        key: existing?.key || (randomID?.() ?? `chaos-corrupt-${Date.now()}`),
        label: game.i18n.localize("W4SQ.PassiveChaosCorruptive"),
        duration: 2,
        mods: {
          tags: { chaosCorrupted: true, chaosCorruptedStacks: stacks },
          moraleDice: "+0"
        }
      }, eff => Boolean(eff?.mods?.tags?.chaosCorrupted));
    }
    if (passives.chaosMutation) {
      await handleChaosPostHit(attacker, defender, { success, hpDamage });
    }
  }
  if (origin === "ratmen" && passives.ratNumerous) {
    await ensureEffect(defender, {
      key: randomID?.() ?? `rat-overwhelm-${Date.now()}`,
      label: game.i18n.localize("W4SQ.PassiveRatNumerous"),
      duration: 2,
      mods: { tags: { overwhelmed: true }, tnDice: "-5", dmgDice: "+0", defPenaltyDice: "0" }
    }, eff => Boolean(eff?.mods?.tags?.overwhelmed));
  }
  if (origin === "undead") {
    if (passives.undeadLifeDrain && hpDamage > 0 && !targetIsPuppet) {
      const heal = Math.floor(hpDamage * 0.5);
      if (heal > 0) {
        const hpCurrent = getNumberFlag(attacker, "hp");
        const hpMax = getNumberFlag(attacker, "hpMax");
        await attacker.setFlag(FLAG_SCOPE, "hp", Math.min(hpMax, hpCurrent + heal));
        await sendPassiveMessage(attacker, "W4SQ.PassiveMsgUndeadLifeDrain", {
          name: safeName(attacker),
          target: safeName(defender),
          amount: heal
        });
      }
    }
    if (passives.undeadMarchOfTheDead && hpDamage > 0 && getNumberFlag(attacker, "morale") > 0 && !sameSide(attacker, defender)) {
      await ensureEffect(defender, {
        key: randomID?.() ?? `undead-overwhelm-${Date.now()}`,
        label: game.i18n.localize("W4SQ.EffectOverwhelmed"),
        duration: 2,
        mods: { tags: { overwhelmed: true }, tnDice: "-5" }
      }, eff => Boolean(eff?.mods?.tags?.overwhelmed));
      await sendPassiveMessage(attacker, "W4SQ.PassiveMsgUndeadMarchOverwhelm", {
        name: safeName(attacker),
        target: safeName(defender)
      });
    }
  }
}

export async function recordDamageTaken(defender, { hpDamage = 0 } = {}) {
  if (!defender || hpDamage <= 0) return;
  const origin = getOrigin(defender);
  const passives = getPassives(defender);

  if (origin === "dwarf" && passives.dwarfGrudgin) {
    const current = Number(defender.getFlag(FLAG_SCOPE, "dwarfGrudgeTicks") || 0);
    const next = Math.min(current + 1, 4);
    await defender.setFlag(FLAG_SCOPE, "dwarfGrudgeTicks", next);
    await sendPassiveMessage(defender, "W4SQ.PassiveMsgDwarfGrudgin", {
      name: safeName(defender),
      amount: Math.min(next * 5, 20)
    });
  }
  if (origin === "elf" && passives.elfSwift) {
    await defender.setFlag(FLAG_SCOPE, "elfSwiftReady", true);
  }
  if (origin === "greenskin" && passives.greenMobMentality) {
    const info = ensureFlagObject(defender, "greenMobDamage", {});
    const { round } = getRoundSignature();
    if (info.round !== round) {
      info.round = round;
      info.value = 0;
    }
    info.value = (info.value || 0) + hpDamage;
    await defender.setFlag(FLAG_SCOPE, "greenMobDamage", info);
  }
  if (origin === "chaos" && passives.chaosMutation) {
    const mutation = defender.getFlag(FLAG_SCOPE, "chaosMutation");
    if (mutation === "ritualistic_sacrifice") {
      const stacks = Number(defender.getFlag(FLAG_SCOPE, "chaosRitualStacks") || 0);
      await defender.setFlag(FLAG_SCOPE, "chaosRitualStacks", Math.min(5, stacks + 1));
    }
  }
  if (origin === "undead" && passives.undeadMarchOfTheDead) {
    const morale = getNumberFlag(defender, "morale");
    if (morale > 0) {
      const tracker = ensureFlagObject(defender, "undeadMarchLoss", { loss: 0 });
      tracker.loss = (tracker.loss || 0) + hpDamage;
      let hpCurrent = getNumberFlag(defender, "hp");
      const hpMax = getNumberFlag(defender, "hpMax");
      let healedTotal = 0;
      while (tracker.loss >= 100) {
        tracker.loss -= 100;
        const roll = await new Roll("1d2").evaluate({});
        if (roll.total === 1 && hpCurrent < hpMax) {
          const healRoll = await new Roll("3d10+30").evaluate({});
          const applied = Math.min(healRoll.total, Math.max(0, hpMax - hpCurrent));
          hpCurrent = Math.min(hpMax, hpCurrent + healRoll.total);
          healedTotal += applied;
        }
      }
      tracker.loss = Math.max(0, tracker.loss);
      await defender.setFlag(FLAG_SCOPE, "undeadMarchLoss", tracker);
      if (healedTotal > 0) {
        await defender.setFlag(FLAG_SCOPE, "hp", hpCurrent);
        await sendPassiveMessage(defender, "W4SQ.PassiveMsgUndeadMarchRise", {
          name: safeName(defender),
          amount: healedTotal
        });
      }
    } else {
      await defender.unsetFlag(FLAG_SCOPE, "undeadMarchLoss");
    }
  }
}

export async function adjustMoraleLoss(defender, attacker, { total, baseDamage, bonus = 0 } = {}) {
  let next = Number(total) || 0;
  const origin = getOrigin(defender);
  const passives = getPassives(defender);

  if (origin === "human") {
    next = Math.max(0, next - 5);
    if (passives.humanResilient) next = Math.max(0, next - 5);
  }
  if (origin === "chaos") {
    next = Math.max(0, next - 10);
  }
  if (origin === "undead") {
    next = Math.max(0, next - 10);
    if (passives.undeadPuppet && hasUndeadMaster(defender)) {
      next = Math.max(0, next - 10);
    }
  }
  if (origin === "dwarf" && passives.dwarfIronWill) {
    next = Math.max(0, next - 20);
  }
  if (origin === "greenskin" && passives.greenMobMentality && hpRatio(defender) > 0.5) {
    next = Math.floor(next / 2);
  }
  if (origin === "ratmen") {
    next += 5;
    if (passives.ratCoward) next += 20;
    if (passives.ratMuskOfFear) {
      const army = armyHpRatio(defender);
      next = army > 0.5 ? Math.floor(next * 0.75) : Math.floor(next * 1.5);
    }
  }
  if (actorHasTag(defender, "overwhelmed")) {
    next += 10;
  }
  return Math.max(0, next);
}

export async function handleMoraleZero(defender, attacker) {
  const origin = getOrigin(defender);
  const passives = getPassives(defender);
  if (origin === "chaos" && passives.chaosDaemonic) {
    await ensureEffect(defender, {
      key: "chaos-banishing",
      label: game.i18n.localize("W4SQ.PassiveChaosDaemonic"),
      duration: 99,
      mods: { tags: { chaosBanishing: true } }
    }, eff => Boolean(eff?.mods?.tags?.chaosBanishing));
  }
  if (origin !== "human" || !passives.humanToTheBitterEnd) return;
  if (await defender.getFlag(FLAG_SCOPE, "usedBitterEnd")) return;

  await defender.setFlag(FLAG_SCOPE, "usedBitterEnd", true);
  const roll = await new Roll("4d20").evaluate({});
  const morale = Number(defender.getFlag(FLAG_SCOPE, "morale") || 0);
  const moraleMax = Number(defender.getFlag(FLAG_SCOPE, "moraleMax") || 0);
  const restored = Math.min(moraleMax, morale + roll.total);
  const gained = Math.max(0, restored - morale);
  await defender.setFlag(FLAG_SCOPE, "morale", restored);
  await removeDisorganized(defender);
  const effects = getEffects(defender).filter(effect => !effect?.mods?.tags?.routed);
  await defender.setFlag(FLAG_SCOPE, "effects", effects);
  if (moraleMax > 0 && restored <= 0) {
    await defender.setFlag(FLAG_SCOPE, "morale", Math.min(moraleMax, 1));
  }
  await sendPassiveMessage(defender, "W4SQ.PassiveMsgHumanToTheBitterEnd", {
    name: safeName(defender),
    amount: gained
  });
}

export async function handleTurnTick(actor, context = {}) {
  const origin = getOrigin(actor);
  const passives = getPassives(actor);
  const { round } = getRoundSignature();

  if (origin === "undead" && getNumberFlag(actor, "morale") <= 0) {
    const crumble = await new Roll("10+2d10").evaluate({});
    const hp = getNumberFlag(actor, "hp");
    if (crumble.total > 0 && hp > 0) {
      await actor.setFlag(FLAG_SCOPE, "hp", Math.max(0, hp - crumble.total));
      await sendPassiveMessage(actor, "W4SQ.PassiveMsgUndeadCrumbling", {
        name: safeName(actor),
        amount: crumble.total
      });
    }
  }

  if (origin === "monster" && passives.monsterRegeneration && round > 0 && context.turn === 0) {
    const roll = await new Roll("1d20+10").evaluate({});
    const hp = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
    const hpMax = Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 0);
    await actor.setFlag(FLAG_SCOPE, "hp", Math.min(hpMax, hp + roll.total));
    await sendPassiveMessage(actor, "W4SQ.PassiveMsgMonsterRegeneration", {
      name: safeName(actor),
      amount: roll.total
    });
  }
  if (origin === "undead" && passives.undeadRegeneration) {
    const roll = await new Roll("2d10+10").evaluate({});
    const hp = getNumberFlag(actor, "hp");
    const hpMax = getNumberFlag(actor, "hpMax");
    const applied = Math.min(roll.total, Math.max(0, hpMax - hp));
    if (applied > 0) {
      await actor.setFlag(FLAG_SCOPE, "hp", Math.min(hpMax, hp + roll.total));
      await sendPassiveMessage(actor, "W4SQ.PassiveMsgUndeadRegeneration", {
        name: safeName(actor),
        amount: applied
      });
    }
  }
  if (origin === "chaos" && passives.chaosMutation) {
    const regen = await applyChaosRegeneration(actor);
    if (regen) {
      await sendPassiveMessage(actor, "W4SQ.PassiveMsgChaosRegeneration", { name: safeName(actor), amount: regen });
    }
  }
  if (origin === "chaos" && passives.chaosDaemonic) {
    const banishing = getEffects(actor).find(eff => eff?.mods?.tags?.chaosBanishing);
    if (banishing) {
      const roll = await new Roll("5+3d10").evaluate({});
      const hp = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
      await actor.setFlag(FLAG_SCOPE, "hp", Math.max(0, hp - roll.total));
      await sendPassiveMessage(actor, "W4SQ.PassiveMsgChaosBanishing", { name: safeName(actor), amount: roll.total });
    }
  }
  if (origin === "greenskin" && passives.greenSurge) {
    const active = round > 0 && round % 4 === 0;
    await actor.setFlag(FLAG_SCOPE, "greenSurgeActive", active);
  }
  if (origin === "greenskin" && passives.greenMobMentality) {
    const info = ensureFlagObject(actor, "greenMobDamage", {});
    if (info.round !== round) {
      const hpMax = Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 0);
      const triggered = hpMax > 0 && Number(info.value || 0) >= hpMax * 0.5;
      await actor.setFlag(FLAG_SCOPE, "greenMobBonus", triggered ? { remaining: 1 } : { remaining: 0 });
      info.round = round;
      info.value = 0;
      await actor.setFlag(FLAG_SCOPE, "greenMobDamage", info);
    } else {
      const buff = ensureFlagObject(actor, "greenMobBonus", {});
      if (buff.remaining > 0) {
        buff.remaining -= 1;
        await actor.setFlag(FLAG_SCOPE, "greenMobBonus", buff);
      }
    }
  }
  if (origin === "ratmen" && passives.ratTreacherous) {
    const buff = ensureFlagObject(actor, "ratTreacherousBuff", {});
    if (buff.remaining > 0) {
      buff.remaining -= 1;
      await actor.setFlag(FLAG_SCOPE, "ratTreacherousBuff", buff);
    } else if (buff.remaining !== 0) {
      await actor.unsetFlag(FLAG_SCOPE, "ratTreacherousBuff");
    }
  }
}

export async function maybeTriggerAestheticHoB(actor, { roll, tn, target, type }) {
  const origin = getOrigin(actor);
  const passives = getPassives(actor);
  if (origin !== "elf" || !passives.elfAestheticPerfection) return null;
  if (tn <= 0) return null;
  const threshold = Math.floor(tn * 0.1);
  if (roll > threshold) return null;
  await sendPassiveMessage(actor, "W4SQ.PassiveMsgElfAestheticPerfection", {
    name: safeName(actor)
  });
  const forced = await maybeTriggerHoB(actor, { roll: 11, success: true, type, target });
  return forced;
}
