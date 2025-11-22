import { FLAG_SCOPE } from "../config.js";
import { addEffect, removeEffectByKey, ensureEffect, actorHasTag, getEffects, removeDisorganized } from "./effects.js";
import { maybeTriggerHoB } from "./hob.js";

const { randomID } = foundry.utils;

const ORIGINS = ["human", "dwarf", "elf", "monster", "greenskin", "ratmen"];

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
  ratNumerous: "W4SQ.PassiveRatNumerous"
};

const escapeHtml = foundry.utils?.escapeHTML ?? (str => String(str ?? ""));
const RAT_MUSK_BUFF_KEY = "rat-musk-buff";
const RAT_MUSK_DEBUFF_KEY = "rat-musk-debuff";

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

async function syncRatMuskEffect(actor, enabled, ratio) {
  if (!actor) return;
  const label = game.i18n.localize("W4SQ.PassiveRatMuskOfFear");
  if (!enabled) {
    await removeEffectByKey(actor, RAT_MUSK_BUFF_KEY);
    await removeEffectByKey(actor, RAT_MUSK_DEBUFF_KEY);
    return;
  }

  const buffing = ratio > 0.5;
  if (buffing) {
    await removeEffectByKey(actor, RAT_MUSK_DEBUFF_KEY);
    await ensureEffect(actor, {
      key: RAT_MUSK_BUFF_KEY,
      label,
      mods: { tags: { ratMuskOfFear: true, ratMuskBuff: true } }
    }, eff => eff?.key === RAT_MUSK_BUFF_KEY);
  } else {
    await removeEffectByKey(actor, RAT_MUSK_BUFF_KEY);
    await ensureEffect(actor, {
      key: RAT_MUSK_DEBUFF_KEY,
      label,
      mods: { tags: { ratMuskOfFear: true, ratMuskDebuff: true } }
    }, eff => eff?.key === RAT_MUSK_DEBUFF_KEY);
  }
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
  if (origin === "greenskin" && passives.greenGobbos) add(-10);
  if (origin === "greenskin" && passives.greenUnstoppableWave) add(-20);
  if (origin === "monster" && passives.monsterBulky) add(-10);
  if (origin === "monster" && passives.monsterHorrorIncarnate) add(-20);
  if (origin === "monster" && passives.monsterMultipleAppendages) add(-20);
  if (origin === "monster" && passives.monsterMonstrousCharge) add(-10);
  if (origin === "elf" && passives.elfElvenGrace) add(10);
  if (origin === "dwarf" && passives.dwarfGrudgin) {
    const ticks = Number(actor.getFlag(FLAG_SCOPE, "dwarfGrudgeTicks") || 0);
    add(Math.min(4, Math.max(0, ticks)) * 5);
  }
  if (origin === "greenskin" && passives.greenSurge) {
    const surgeActive = Boolean(actor.getFlag(FLAG_SCOPE, "greenSurgeActive"));
    if (surgeActive) add(10);
  }
  const treacherousActive = origin === "ratmen" && passives.ratTreacherous;
  const treacherousTrigger = treacherousActive && opponent && sameSide(actor, opponent);
  const treacherousBuffed = treacherousActive && (actorHasTag(actor, "ratTreacherousBuff") || treacherousTrigger);
  if (treacherousBuffed) add(20);
  if (isManeuver) {
    if (origin === "human" && passives.humanBattleDrill) add(10);
    if (origin === "human" && passives.humanAdaptive && ratio < 0.5) add(10);
    if (origin === "elf" && passives.elfElvenGrace) add(10);
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
  const treacherousActive = origin === "ratmen" && passives.ratTreacherous;
  const treacherousTrigger = treacherousActive && defender && sameSide(actor, defender);
  const treacherousBuffed = treacherousActive && (actorHasTag(actor, "ratTreacherousBuff") || treacherousTrigger);
  if (treacherousBuffed) damage += 10;
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
  if (treacherousTrigger) {
    await ensureEffect(actor, {
      key: randomID?.() ?? `rat-treachery-${Date.now()}`,
      label: game.i18n.localize("W4SQ.PassiveRatTreacherous"),
      duration: 2,
      mods: { tags: { ratTreacherousBuff: true }, tnDice: "+20", dmgDice: "+10" }
    }, eff => Boolean(eff?.mods?.tags?.ratTreacherousBuff));
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

  await syncRatMuskEffect(defender, origin === "ratmen" && passives.ratMuskOfFear, armyRatio);

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
  if (actorHasTag(defender, "overwhelmed")) {
    moraleBonus += 10;
  }

  return { damage: clampNonNegative(damage), moraleBonus: clampNonNegative(moraleBonus) };
}

export async function applyPostAttackEffects({ attacker, defender, success, action, isMagical = false } = {}) {
  if (!success || !defender) return;
  const origin = getOrigin(attacker);
  const passives = getPassives(attacker);

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
  if (origin === "ratmen" && passives.ratNumerous) {
    await ensureEffect(defender, {
      key: randomID?.() ?? `rat-overwhelm-${Date.now()}`,
      label: game.i18n.localize("W4SQ.EffectOverwhelmed"),
      duration: 2,
      mods: { tags: { overwhelmed: true }, tnDice: "-5" }
    }, eff => Boolean(eff?.mods?.tags?.overwhelmed));
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
}

export async function adjustMoraleLoss(defender, attacker, { total, baseDamage, bonus = 0 } = {}) {
  let next = Number(total) || 0;
  const origin = getOrigin(defender);
  const passives = getPassives(defender);
  const ratio = hpRatio(defender);
  const armyRatio = origin === "ratmen" && passives.ratMuskOfFear ? armyHpRatio(defender) : ratio;

  await syncRatMuskEffect(defender, origin === "ratmen" && passives.ratMuskOfFear, armyRatio);

  if (origin === "human") {
    next = Math.max(0, next - 5);
    if (passives.humanResilient) next = Math.max(0, next - 5);
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
      next = armyRatio > 0.5 ? Math.floor(next * 0.75) : Math.floor(next * 1.5);
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

  const ratMuskActive = origin === "ratmen" && passives.ratMuskOfFear;
  const ratMuskRatio = ratMuskActive ? armyHpRatio(actor) : 0;
  await syncRatMuskEffect(actor, ratMuskActive, ratMuskRatio);

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
