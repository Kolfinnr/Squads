import { FLAG_SCOPE, SETTINGS, MODULE_ID, ACTOR_TYPES } from "../config.js";
import { addEffect, getEffects, effectPolarity } from "./effects.js";

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function randomEntry(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const index = Math.floor(Math.random() * list.length);
  return list[index] ?? null;
}

function isSquadActor(actor) {
  return actor && ACTOR_TYPES.includes(actor.type) && actor.getFlag(FLAG_SCOPE, "hp") !== undefined;
}

function sceneTokens() {
  return canvas?.tokens?.placeables ?? [];
}

function tokenDisposition(token) {
  return token?.document?.disposition ?? token?.disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;
}

function actorDisposition(actor) {
  const active = actor?.getActiveTokens?.(true) ?? [];
  if (active.length) {
    return tokenDisposition(active[0]);
  }
  for (const token of sceneTokens()) {
    if (token?.actor === actor) return tokenDisposition(token);
  }
  return CONST.TOKEN_DISPOSITIONS.NEUTRAL;
}

function alliedSquadActors(actor, { includeSelf = true } = {}) {
  const disposition = actorDisposition(actor);
  const set = new Set();
  for (const token of sceneTokens()) {
    const squad = token?.actor;
    if (!isSquadActor(squad)) continue;
    if (tokenDisposition(token) !== disposition) continue;
    if (!includeSelf && squad === actor) continue;
    set.add(squad);
  }
  if (includeSelf && isSquadActor(actor)) {
    set.add(actor);
  }
  return [...set];
}

function randomActor(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const idx = Math.floor(Math.random() * list.length);
  return list[idx] ?? null;
}

async function removeEffectsByPredicate(actor, predicate) {
  const list = getEffects(actor);
  const filtered = list.filter(effect => !predicate(effect));
  if (filtered.length === list.length) return false;
  await actor.setFlag(FLAG_SCOPE, "effects", filtered);
  return true;
}

async function removeTagged(actor, tag) {
  return removeEffectsByPredicate(actor, eff => eff?.mods?.tags?.[tag]);
}

async function removeFirstNegative(actor) {
  const list = getEffects(actor);
  const index = list.findIndex(effect => effectPolarity(effect) === "negative");
  if (index === -1) return false;
  list.splice(index, 1);
  await actor.setFlag(FLAG_SCOPE, "effects", list);
  return true;
}

async function removePositiveEffects(actor) {
  return removeEffectsByPredicate(actor, effect => effectPolarity(effect) === "positive");
}

async function removeDisorganized(actor) {
  return removeTagged(actor, "disorganized");
}

async function removeTired(actor) {
  return removeTagged(actor, "tired");
}

async function rollFormula(formula) {
  return (await new Roll(formula).roll({ async: true }));
}

function immediateFromRoll(roll) {
  return { total: roll.total, formula: roll.formula };
}

async function adjustResource(actor, key, delta, { min = 0, maxFlag } = {}) {
  const current = Number(actor.getFlag(FLAG_SCOPE, key) || 0);
  let next = current + delta;
  if (maxFlag) {
    const cap = Number(actor.getFlag(FLAG_SCOPE, maxFlag) || 0);
    if (Number.isFinite(cap) && cap > 0) {
      next = Math.min(cap, next);
    }
  }
  if (min !== undefined && min !== null) {
    next = Math.max(min, next);
  }
  await actor.setFlag(FLAG_SCOPE, key, next);
  return next - current;
}

async function adjustHP(actor, delta) {
  return adjustResource(actor, "hp", delta, { min: 0, maxFlag: "hpMax" });
}

async function adjustMorale(actor, delta) {
  return adjustResource(actor, "morale", delta, { min: 0, maxFlag: "moraleMax" });
}

function buildDetail(summary, { tn = [], damage = [] } = {}) {
  return {
    summary: summary ?? null,
    immediate: {
      tn,
      damage
    }
  };
}

function ensureImmediate(value) {
  if (!value) return null;
  if (typeof value === "number") {
    return { total: value, formula: "" };
  }
  if (typeof value === "object") {
    const total = Number(value.total ?? value.value ?? value.amount ?? NaN);
    if (!Number.isFinite(total)) return null;
    const formula = value.formula ?? value.dice ?? value.roll ?? "";
    return { total, formula };
  }
  return null;
}

function normalizeDetail(detail) {
  if (!detail) {
    return buildDetail(null);
  }
  if (typeof detail === "string") {
    return buildDetail(detail);
  }
  const summary = detail.summary ?? null;
  const immediate = detail.immediate ?? {};
  return {
    summary,
    immediate: {
      tn: toArray(immediate.tn).map(ensureImmediate).filter(Boolean),
      damage: toArray(immediate.damage).map(ensureImmediate).filter(Boolean)
    }
  };
}

function describeImmediate(immediate = {}) {
  const tnAdjustments = toArray(immediate.tn);
  const damageAdjustments = toArray(immediate.damage);
  const strings = [];

  for (const item of tnAdjustments) {
    strings.push(game.i18n.format("W4SQ.ChatHoBTn", { total: item.total, formula: item.formula || "" }));
  }
  for (const item of damageAdjustments) {
    strings.push(game.i18n.format("W4SQ.ChatHoBDamage", { total: item.total, formula: item.formula || "" }));
  }

  return { strings, tnAdjustments, damageAdjustments };
}

async function resolveEvent(actor, pool, heading, context = {}) {
  const entry = randomEntry(pool);
  if (!entry) return null;
  const rawResult = await entry.apply?.(actor, context);
  const detailSource = rawResult && typeof rawResult === "object" && Object.prototype.hasOwnProperty.call(rawResult, "detail")
    ? rawResult.detail
    : rawResult;
  const detail = normalizeDetail(detailSource);
  const immediateDesc = describeImmediate(detail.immediate);

  const extras = [];
  if (detail.summary) extras.push(detail.summary);
  if (immediateDesc.strings.length) {
    extras.push(game.i18n.format("W4SQ.ChatHoBImmediate", { effects: immediateDesc.strings.join(", ") }));
  }
  const extraText = extras.length ? `<br/><em>${extras.join("<br/>")}</em>` : "";
  const content = `<h3>${heading}</h3><p><strong>${entry.title}</strong> – ${entry.text}${extraText}</p>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });

  return {
    heading,
    title: entry.title,
    summary: detail.summary,
    immediateStrings: immediateDesc.strings,
    immediate: {
      tn: immediateDesc.tnAdjustments,
      damage: immediateDesc.damageAdjustments
    },
    damageMultiplier: Number(rawResult?.damageMultiplier ?? 1) || 1
  };
}


const GOOD_DOUBLE = [
  {
    key: "blades-of-glory",
    title: "Blades of Glory",
    text: "Blows land with lethal perfection.",
    apply: async (actor) => ({
      detail: buildDetail("Double this attack's damage"),
      damageMultiplier: 2
    })
  },
  {
    key: "standard-raised",
    title: "Standard Raised",
    text: "Banners snap to inspire nearby allies.",
    apply: async (actor) => {
      const roll = await rollFormula("1d10");
      const allies = alliedSquadActors(actor, { includeSelf: true });
      for (const ally of allies) {
        await adjustMorale(ally, roll.total);
      }
      return buildDetail(`Allies +${roll.total} Morale (${roll.formula})`);
    }
  },
  {
    key: "inspired-valor",
    title: "Inspired Valor",
    text: "Orders flow flawlessly for the next maneuver.",
    apply: async (actor) => {
      await actor.setFlag(FLAG_SCOPE, "hob_autoPassManeuver", true);
      return buildDetail("Auto-pass next maneuver");
    }
  },
  {
    key: "flawless-coordination",
    title: "Flawless Coordination",
    text: "Every squad member moves without hindrance.",
    apply: async (actor) => {
      await addEffect(actor, {
        key: "hob-flawless-coordination",
        label: "Flawless Coordination",
        duration: 1,
        mods: { tags: { ignorePenalties: true } }
      });
      return buildDetail("Ignore penalties for 1 round");
    }
  },
  {
    key: "enemy-falters",
    title: "Enemy Falters",
    text: "The foe reels under the assault.",
    apply: async (actor, context = {}) => {
      const target = context?.target;
      if (target && isSquadActor(target)) {
        await addEffect(target, {
          key: "hob-enemy-falters",
          label: "Enemy Falters",
          duration: 1,
          mods: { tnDice: "-1d20" }
        });
      }
      return buildDetail("Target −1d20 TN next round");
    }
  },
  {
    key: "banner-of-victory",
    title: "Banner of Victory",
    text: "Victorious shouts swell morale.",
    apply: async (actor) => {
      const roll = await rollFormula("3d10");
      await adjustMorale(actor, roll.total);
      return buildDetail(`+${roll.total} Morale (${roll.formula})`);
    }
  },
  {
    key: "surge-forward",
    title: "Surge Forward",
    text: "Momentum drives the unit ahead.",
    apply: async (actor) => {
      await addEffect(actor, {
        key: "hob-surge-forward",
        label: "Surge Forward",
        duration: 1,
        mods: { tags: { freeMove: true, charged: true } }
      });
      return buildDetail("May move/charge 5m extra this round");
    }
  },
  {
    key: "righteous-fury",
    title: "Righteous Fury",
    text: "Every strike carries righteous wrath.",
    apply: async (actor) => {
      const roll = await rollFormula("2d20");
      await addEffect(actor, {
        key: "hob-righteous-fury",
        label: "Righteous Fury",
        duration: 1,
        mods: { dmgDice: "+2d20" }
      });
      return buildDetail("+2d20 Damage (1 round)", { damage: [immediateFromRoll(roll)] });
    }
  },
  {
    key: "protect-the-fallen",
    title: "Protect the Fallen",
    text: "The wounded are dragged back into line.",
    apply: async (actor) => {
      const roll = await rollFormula("1d10");
      await adjustHP(actor, roll.total);
      return buildDetail(`+${roll.total} HP (${roll.formula})`);
    }
  },
  {
    key: "divine-intervention",
    title: "Divine Intervention",
    text: "Fortune shields the squad from harm.",
    apply: async (actor) => {
      const removed = await removeFirstNegative(actor);
      return buildDetail(removed ? "One debuff removed" : "No debuff to remove");
    }
  }
];

const BAD_DOUBLE = [
  {
    key: "weapon-break",
    title: "Weapon Break",
    text: "Weapons snap at the worst moment.",
    apply: async (actor) => {
      const roll = await rollFormula("2d10");
      await addEffect(actor, {
        key: "hob-weapon-break",
        label: "Weapon Break",
        duration: 1,
        mods: { tnDice: "-2d10" }
      });
      return { detail: buildDetail("-2d10 TN next round", { tn: [immediateFromRoll(roll)] }), damageMultiplier: 0 };
    }
  },
  {
    key: "friendly-fire",
    title: "Friendly Fire",
    text: "Loose shots strike friendly ranks.",
    apply: async (actor) => {
      const roll = await rollFormula("1d10");
      const allies = alliedSquadActors(actor, { includeSelf: false });
      const target = randomActor(allies) || actor;
      await adjustHP(target, -roll.total);
      return buildDetail(`-${roll.total} HP to ally (${roll.formula})`);
    }
  },
  {
    key: "slip-in-the-mud",
    title: "Slip in the Mud",
    text: "Feet slide and formations stagger.",
    apply: async (actor) => {
      await addEffect(actor, {
        key: "hob-slip-mud",
        label: "Disorganized",
        duration: 1,
        mods: { defPenaltyDice: "-1d20", tags: { disorganized: true } }
      });
      return buildDetail("Disorganized (1 round)");
    }
  },
  {
    key: "panic-chain",
    title: "Panic Chain",
    text: "Nearby troops waver.",
    apply: async (actor) => {
      const roll = await rollFormula("1d10");
      const allies = alliedSquadActors(actor, { includeSelf: false });
      const target = randomActor(allies) || actor;
      await adjustMorale(target, -roll.total);
      return buildDetail(`-${roll.total} Morale to ally (${roll.formula})`);
    }
  },
  {
    key: "commander-hesitates",
    title: "Commander Hesitates",
    text: "Orders stall at a critical moment.",
    apply: async (actor) => {
      await addEffect(actor, {
        key: "hob-commander-hesitates",
        label: "Commander Hesitates",
        duration: 1,
        mods: { tags: { skipTurn: true } }
      });
      return buildDetail("Skip next turn");
    }
  },
  {
    key: "weapon-jam",
    title: "Weapon Jam",
    text: "Mechanisms seize mid-battle.",
    apply: async () => ({
      detail: buildDetail("Half damage"),
      damageMultiplier: 0.5
    })
  },
  {
    key: "poor-communication",
    title: "Poor Communication",
    text: "Signals fail to carry down the line.",
    apply: async (actor) => {
      const roll = await rollFormula("1d10");
      await addEffect(actor, {
        key: "hob-poor-communication",
        label: "Poor Communication",
        duration: 2,
        mods: { tnDice: "-1d10" }
      });
      return buildDetail("-1d10 TN for 2 rounds", { tn: [immediateFromRoll(roll)] });
    }
  },
  {
    key: "trampled-bodies",
    title: "Trampled Bodies",
    text: "Fallen comrades slow the advance.",
    apply: async (actor) => {
      const roll = await rollFormula("1d10");
      await adjustHP(actor, -roll.total);
      return buildDetail(`-${roll.total} HP (${roll.formula})`);
    }
  },
  {
    key: "chaos-in-the-ranks",
    title: "Chaos in the Ranks",
    text: "Buffs collapse as disorder spreads.",
    apply: async (actor) => {
      await removePositiveEffects(actor);
      await addEffect(actor, {
        key: "hob-chaos-ranks",
        label: "Disorganized",
        duration: 1,
        mods: { defPenaltyDice: "-1d20", tags: { disorganized: true } }
      });
      return buildDetail("Lose buffs & become Disorganized");
    }
  },
  {
    key: "utter-rout",
    title: "Utter Rout!",
    text: "The unit breaks and flees.",
    apply: async (actor) => {
      const morale = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
      if (morale > 0) {
        await actor.setFlag(FLAG_SCOPE, "morale", 0);
      }
      await addEffect(actor, {
        key: "hob-utter-rout",
        label: "Utter Rout",
        duration: 2,
        mods: { tags: { skipTurn: true, disengaged: true, disorganized: true } }
      });
      return buildDetail("Morale drops to 0; unit flees");
    }
  }
];

const HP_EVENTS = [
  {
    key: "commander-slain",
    title: "Commander Slain",
    text: "Leadership falls in battle.",
    apply: async (actor) => {
      const roll = await rollFormula("2d20");
      await adjustMorale(actor, -roll.total);
      return buildDetail(`-${roll.total} Morale (${roll.formula})`);
    }
  },
  {
    key: "heavy-losses",
    title: "Heavy Losses",
    text: "Casualties pile high.",
    apply: async (actor) => {
      const roll = await rollFormula("2d20");
      await adjustHP(actor, -roll.total);
      return buildDetail(`-${roll.total} HP (${roll.formula})`);
    }
  },
  {
    key: "mud-and-blood",
    title: "Mud and Blood",
    text: "The unit bogs down in gore and mud.",
    apply: async (actor) => {
      await addEffect(actor, {
        key: "hob-mud-blood",
        label: "Disorganized",
        duration: 2,
        mods: { defPenaltyDice: "-1d20", tags: { disorganized: true } }
      });
      return buildDetail("Disorganized (2 rounds)");
    }
  },
  {
    key: "reinforcements",
    title: "Reinforcements",
    text: "Fresh troops bolster the line.",
    apply: async (actor) => {
      const roll = await rollFormula("1d20");
      await adjustHP(actor, roll.total);
      return buildDetail(`+${roll.total} HP (${roll.formula})`);
    }
  },
  {
    key: "battlefield-medic",
    title: "Battlefield Medic",
    text: "Field healers stem the losses.",
    apply: async (actor) => {
      const roll = await rollFormula("1d10");
      await adjustHP(actor, roll.total);
      await removeTired(actor);
      return buildDetail(`+${roll.total} HP (${roll.formula}) & remove Tired`);
    }
  },
  {
    key: "desperate-push",
    title: "Desperate Push",
    text: "The unit fights beyond limits.",
    apply: async (actor) => {
      const roll = await rollFormula("2d10");
      await addEffect(actor, {
        key: "hob-desperate-push",
        label: "Desperate Push",
        duration: 1,
        mods: { dmgDice: "+2d10", tags: { tired: true } }
      });
      return buildDetail("+2d10 Damage & Tired (1 round)", { damage: [immediateFromRoll(roll)] });
    }
  },
  {
    key: "broken-formation",
    title: "Broken Formation",
    text: "Defensive ranks collapse.",
    apply: async (actor) => {
      await addEffect(actor, {
        key: "hob-broken-formation",
        label: "Broken Formation",
        duration: 1,
        mods: { tags: { noDefense: true } }
      });
      return buildDetail("Lose all defense for 1 round");
    }
  },
  {
    key: "cohesion-restored",
    title: "Cohesion Restored",
    text: "Discipline returns to the ranks.",
    apply: async (actor) => {
      const roll = await rollFormula("1d10");
      await removeDisorganized(actor);
      await adjustHP(actor, roll.total);
      return buildDetail(`Remove Disorganized & +${roll.total} HP (${roll.formula})`);
    }
  },
  {
    key: "too-many-dead",
    title: "Too Many Dead",
    text: "Losses sap the unit's resolve.",
    apply: async (actor) => {
      const moraleRoll = await rollFormula("1d20");
      const tnRoll = await rollFormula("1d10");
      await adjustMorale(actor, -moraleRoll.total);
      await addEffect(actor, {
        key: "hob-too-many-dead",
        label: "Too Many Dead",
        duration: 1,
        mods: { tnDice: "-1d10" }
      });
      return buildDetail(`-${moraleRoll.total} Morale (${moraleRoll.formula}) & -1d10 TN (1 round)`, { tn: [immediateFromRoll(tnRoll)] });
    }
  },
  {
    key: "glorious-resistance",
    title: "Glorious Resistance",
    text: "The unit digs in against impossible odds.",
    apply: async (actor) => {
      await addEffect(actor, {
        key: "hob-glorious-resistance",
        label: "Glorious Resistance",
        duration: 1,
        mods: { tags: { halfDamage: true } }
      });
      return buildDetail("Take half damage for 1 round");
    }
  }
];

const MORALE_EVENTS = [
  {
    key: "banner-falls",
    title: "Banner Falls!",
    text: "The standard crashes to the ground.",
    apply: async (actor) => {
      const roll = await rollFormula("2d20");
      await adjustMorale(actor, -roll.total);
      return buildDetail(`-${roll.total} Morale (${roll.formula})`);
    }
  },
  {
    key: "panic-spreads",
    title: "Panic Spreads",
    text: "Fear ripples through the line.",
    apply: async (actor) => {
      await addEffect(actor, {
        key: "hob-panic-spreads",
        label: "Panic Spreads",
        duration: 1,
        mods: { tnDice: "-1d10", defPenaltyDice: "-1d20", tags: { disorganized: true } }
      });
      return buildDetail("Disorganized & -1d10 TN (1 round)");
    }
  },
  {
    key: "surrender-whispers",
    title: "Surrender Whispers",
    text: "Voices call for withdrawal.",
    apply: async (actor) => {
      const roll = await rollFormula("1d20");
      const tnRoll = await rollFormula("1d10");
      await adjustMorale(actor, -roll.total);
      await addEffect(actor, {
        key: "hob-surrender-whispers",
        label: "Surrender Whispers",
        duration: 1,
        mods: { tnDice: "-1d10" }
      });
      return buildDetail(`-${roll.total} Morale (${roll.formula}) & -1d10 TN`, { tn: [immediateFromRoll(tnRoll)] });
    }
  },
  {
    key: "rallying-cry",
    title: "Rallying Cry",
    text: "Leaders shout renewed purpose.",
    apply: async (actor) => {
      const roll = await rollFormula("2d10");
      await adjustMorale(actor, roll.total);
      return buildDetail(`+${roll.total} Morale (${roll.formula})`);
    }
  },
  {
    key: "frenzied-desperation",
    title: "Frenzied Desperation",
    text: "The squad fights with reckless abandon.",
    apply: async (actor) => {
      const tnRoll = await rollFormula("1d10");
      const dmgRoll = await rollFormula("1d10");
      await addEffect(actor, {
        key: "hob-frenzied-desperation",
        label: "Frenzied Desperation",
        duration: 1,
        mods: { tnDice: "+1d10", dmgDice: "+1d10" }
      });
      return buildDetail("+1d10 TN & +1d10 Damage (1 round)", { tn: [immediateFromRoll(tnRoll)], damage: [immediateFromRoll(dmgRoll)] });
    }
  },
  {
    key: "faith-rekindled",
    title: "Faith Rekindled",
    text: "Belief steels the hearts of the troops.",
    apply: async (actor) => {
      const roll = await rollFormula("3d10");
      await adjustMorale(actor, roll.total);
      return buildDetail(`+${roll.total} Morale (${roll.formula})`);
    }
  },
  {
    key: "hold-the-line",
    title: "Hold the Line!",
    text: "Shields lock and spears brace.",
    apply: async (actor) => {
      await addEffect(actor, {
        key: "hob-hold-the-line",
        label: "Hold the Line!",
        duration: 1,
        mods: { defSoakDice: "+1d10" }
      });
      return buildDetail("+1d10 Defense (1 round)");
    }
  },
  {
    key: "fear-turns-to-rage",
    title: "Fear Turns to Rage",
    text: "Terror twists into murderous fury.",
    apply: async (actor) => {
      const moraleRoll = await rollFormula("2d10");
      const dmgRoll = await rollFormula("2d10");
      await adjustMorale(actor, moraleRoll.total);
      await addEffect(actor, {
        key: "hob-fear-rage",
        label: "Fear Turns to Rage",
        duration: 1,
        mods: { dmgDice: "+2d10" }
      });
      return buildDetail(`+${moraleRoll.total} Morale (${moraleRoll.formula}) & +2d10 Damage (1 round)`, { damage: [immediateFromRoll(dmgRoll)] });
    }
  },
  {
    key: "despair-overwhelms",
    title: "Despair Overwhelms",
    text: "Hearts sink into hopelessness.",
    apply: async (actor) => {
      const roll = await rollFormula("3d10");
      await adjustMorale(actor, -roll.total);
      await addEffect(actor, {
        key: "hob-despair-overwhelms",
        label: "Despair Overwhelms",
        duration: 1,
        mods: { tags: { tired: true } }
      });
      return buildDetail(`-${roll.total} Morale (${roll.formula}) & Tired`);
    }
  },
  {
    key: "heroic-rally",
    title: "Heroic Rally!",
    text: "Heroes raise the fallen banner.",
    apply: async (actor) => {
      const roll = await rollFormula("5d10");
      await adjustMorale(actor, roll.total);
      await removeDisorganized(actor);
      return buildDetail(`+${roll.total} Morale (${roll.formula}) & remove Disorganized`);
    }
  }
];
export async function maybeTriggerHoB(actor, { roll, success, type } = {}) {
  if (!game.settings.get(MODULE_ID, SETTINGS.enableHoB)) return null;
  const results = [];
  const context = { type };

  const isDouble = roll >= 11 && roll <= 99 && roll % 11 === 0;
  if (isDouble) {
    const heading = success ? game.i18n.localize("W4SQ.HoBGood") : game.i18n.localize("W4SQ.HoBBad");
    const event = await resolveEvent(actor, success ? GOOD_DOUBLE : BAD_DOUBLE, heading, context);
    if (event) results.push(event);
  }

  const hp = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
  const hpMax = Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 0);
  const morale = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
  const moraleMax = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 0);

  if (hpMax > 0 && hp / hpMax <= 0.3 && !actor.getFlag(FLAG_SCOPE, "hob_hp30")) {
    await actor.setFlag(FLAG_SCOPE, "hob_hp30", true);
    const heading = game.i18n.localize("W4SQ.HoBLowHP");
    const event = await resolveEvent(actor, HP_EVENTS, heading, { ...context, threshold: "hp" });
    if (event) results.push(event);
  }

  if (moraleMax > 0 && morale / moraleMax <= 0.3 && !actor.getFlag(FLAG_SCOPE, "hob_mo30")) {
    await actor.setFlag(FLAG_SCOPE, "hob_mo30", true);
    const heading = game.i18n.localize("W4SQ.HoBLowMorale");
    const event = await resolveEvent(actor, MORALE_EVENTS, heading, { ...context, threshold: "morale" });
    if (event) results.push(event);
  }

  if (!results.length) return null;

  const notes = [];
  const tnAdjustments = [];
  const damageAdjustments = [];
  let damageMultiplier = 1;

  for (const event of results) {
    const label = game.i18n.format("W4SQ.ChatHoBSummary", { heading: event.heading, title: event.title });
    const parts = [];
    if (event.summary) parts.push(event.summary);
    if (event.immediateStrings?.length) {
      parts.push(game.i18n.format("W4SQ.ChatHoBImmediate", { effects: event.immediateStrings.join(", ") }));
    }
    notes.push({ title: label, detail: parts.join(" — ") });
    tnAdjustments.push(...(event.immediate?.tn ?? []));
    damageAdjustments.push(...(event.immediate?.damage ?? []));
    damageMultiplier *= Number(event.damageMultiplier || 1) || 1;
  }

  return { notes, tnAdjustments, damageAdjustments, damageMultiplier };
}
