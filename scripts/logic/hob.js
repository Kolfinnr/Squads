import { FLAG_SCOPE, SETTINGS, MODULE_ID } from "../config.js";
import { addEffect, clearNegative } from "./effects.js";

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function randomEntry(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const index = Math.floor(Math.random() * list.length);
  return list[index] ?? null;
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
  const detail = normalizeDetail(await entry.apply?.(actor, context));
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
    }
  };
}

const GOOD_DOUBLE = [
  {
    key: "critical-push",
    title: "Critical Push",
    text: "Momentum surges forward.",
    apply: async actor => {
      const tnRoll = await rollFormula("2d10");
      const dmgRoll = await rollFormula("2d10");
      await addEffect(actor, {
        key: "hob-critical-push",
        label: "Critical Push",
        duration: 1,
        mods: { tnDice: "+2d10", dmgDice: "+2d10" }
      });
      return buildDetail("+2d10 TN / +2d10 damage (1 round)", {
        tn: [immediateFromRoll(tnRoll)],
        damage: [immediateFromRoll(dmgRoll)]
      });
    }
  },
  {
    key: "perfect-timing",
    title: "Perfect Timing",
    text: "Officers seize the perfect moment to strike.",
    apply: async actor => {
      const tnRoll = await rollFormula("2d10");
      await addEffect(actor, {
        key: "hob-perfect-timing",
        label: "Perfect Timing",
        duration: 1,
        mods: { tnDice: "+2d10" }
      });
      return buildDetail("+2d10 TN (1 round)", { tn: [immediateFromRoll(tnRoll)] });
    }
  },
  {
    key: "killer-instinct",
    title: "Killer Instinct",
    text: "Every strike lands with ruthless precision.",
    apply: async actor => {
      const dmgRoll = await rollFormula("2d10");
      await addEffect(actor, {
        key: "hob-killer-instinct",
        label: "Killer Instinct",
        duration: 1,
        mods: { dmgDice: "+2d10" }
      });
      return buildDetail("+2d10 damage (1 round)", { damage: [immediateFromRoll(dmgRoll)] });
    }
  },
  {
    key: "heroic-officer",
    title: "Heroic Officer",
    text: "Leadership rallies the unit to renewed effort.",
    apply: async actor => {
      const tnRoll = await rollFormula("1d10");
      const dmgRoll = await rollFormula("1d10");
      await addEffect(actor, {
        key: "hob-heroic-officer",
        label: "Heroic Officer",
        duration: 1,
        mods: { tnDice: "+1d10", dmgDice: "+1d10" }
      });
      const moraleRoll = await rollFormula("1d10");
      const moraleGain = await adjustMorale(actor, moraleRoll.total);
      return buildDetail(`+1d10 TN / +1d10 damage (1 round) — +${Math.max(0, Math.round(moraleGain))} Morale (${moraleRoll.formula})`, {
        tn: [immediateFromRoll(tnRoll)],
        damage: [immediateFromRoll(dmgRoll)]
      });
    }
  },
  {
    key: "unyielding-advance",
    title: "Unyielding Advance",
    text: "Ranks tighten and surge forward in lockstep.",
    apply: async actor => {
      await clearNegative(actor);
      await addEffect(actor, {
        key: "hob-unyielding-advance",
        label: "Unyielding Advance",
        duration: 1,
        mods: { defSoakDice: "+2d10", dmgDice: "+1d10" }
      });
      return buildDetail("Remove penalties, gain +2d10 soak / +1d10 damage (1 round)");
    }
  },
  {
    key: "coordinated-assault",
    title: "Coordinated Assault",
    text: "Signals line up and the attack lands together.",
    apply: async actor => {
      const tnRoll = await rollFormula("1d20");
      await addEffect(actor, {
        key: "hob-coordinated-assault",
        label: "Coordinated Assault",
        duration: 1,
        mods: { tnDice: "+1d20" }
      });
      return buildDetail("+1d20 TN (1 round)", { tn: [immediateFromRoll(tnRoll)] });
    }
  },
  {
    key: "shield-wall",
    title: "Shield Wall",
    text: "The front rank locks shields and absorbs the blow.",
    apply: async actor => {
      await addEffect(actor, {
        key: "hob-shield-wall",
        label: "Shield Wall",
        duration: 2,
        mods: { defSoakDice: "+3d10", tags: { resistChargeBonus: true } }
      });
      return buildDetail("+3d10 soak (2 rounds)");
    }
  },
  {
    key: "rallying-banner",
    title: "Rallying Banner",
    text: "The banner bearer steadies every heart.",
    apply: async actor => {
      const roll = await rollFormula("2d10");
      const change = await adjustMorale(actor, roll.total);
      return buildDetail(`+${Math.max(0, Math.round(change))} Morale (${roll.formula})`);
    }
  },
  {
    key: "relentless-volley",
    title: "Relentless Volley",
    text: "Arrows and shot rain without pause.",
    apply: async actor => {
      const dmgRoll = await rollFormula("2d10");
      await addEffect(actor, {
        key: "hob-relentless-volley",
        label: "Relentless Volley",
        duration: 1,
        mods: { dmgDice: "+2d10", tags: { multiShot: 2, multiShotHalf: true } }
      });
      return buildDetail("+2d10 damage & multi-shot (1 round)", { damage: [immediateFromRoll(dmgRoll)] });
    }
  },
  {
    key: "tactical-insight",
    title: "Tactical Insight",
    text: "Precise orders set up the next maneuver.",
    apply: async actor => {
      await addEffect(actor, {
        key: "hob-tactical-insight",
        label: "Tactical Insight",
        duration: 1,
        mods: { maneuverTNDice: "+6d10" }
      });
      return buildDetail("+6d10 Maneuver TN (1 round)");
    }
  }
];

const BAD_DOUBLE = [
  {
    key: "officer-down",
    title: "Officer Down",
    text: "The line staggers as leadership falters.",
    apply: async actor => {
      const roll = await rollFormula("1d20");
      const change = await adjustMorale(actor, -roll.total);
      return buildDetail(`-${Math.abs(Math.round(change))} Morale (${roll.formula})`);
    }
  },
  {
    key: "chaos-in-ranks",
    title: "Chaos in the Ranks",
    text: "Formation breaks apart.",
    apply: async actor => {
      await addEffect(actor, {
        key: "hob-chaos",
        label: "Disorganized",
        duration: 1,
        mods: { defPenaltyDice: "-1d20", tags: { disorganized: true } }
      });
      return buildDetail("Disorganized (1 round)");
    }
  },
  {
    key: "weapon-jam",
    title: "Weapon Jam",
    text: "A key volley misfires and must be cleared.",
    apply: async actor => {
      const tnRoll = await rollFormula("2d10");
      await addEffect(actor, {
        key: "hob-weapon-jam",
        label: "Weapon Jam",
        duration: 1,
        mods: { tnDice: "-2d10", tags: { tired: true } }
      });
      return buildDetail("-2d10 TN (1 round)", { tn: [immediateFromRoll(tnRoll)] });
    }
  },
  {
    key: "blunted-assault",
    title: "Blunted Assault",
    text: "Momentum stalls and blows lose force.",
    apply: async actor => {
      const dmgRoll = await rollFormula("2d10");
      await addEffect(actor, {
        key: "hob-blunted-assault",
        label: "Blunted Assault",
        duration: 1,
        mods: { dmgDice: "-2d10" }
      });
      return buildDetail("-2d10 damage (1 round)", { damage: [immediateFromRoll(dmgRoll)] });
    }
  },
  {
    key: "shaken-lines",
    title: "Shaken Lines",
    text: "The formation wavers.",
    apply: async actor => {
      await addEffect(actor, {
        key: "hob-shaken-lines",
        label: "Shaken Lines",
        duration: 1,
        mods: { defPenaltyDice: "-1d20" }
      });
      return buildDetail("-1d20 soak (1 round)");
    }
  },
  {
    key: "exhausted-push",
    title: "Exhausted Push",
    text: "Fatigue drags at every step.",
    apply: async actor => {
      const tnRoll = await rollFormula("1d10");
      await addEffect(actor, {
        key: "hob-exhausted-push",
        label: "Exhausted Push",
        duration: 2,
        mods: { tnDice: "-1d10", tags: { tired: true } }
      });
      return buildDetail("-1d10 TN (2 rounds)", { tn: [immediateFromRoll(tnRoll)] });
    }
  },
  {
    key: "miscommunication",
    title: "Miscommunication",
    text: "Orders cross and the squad hesitates.",
    apply: async actor => {
      await addEffect(actor, {
        key: "hob-miscommunication",
        label: "Miscommunication",
        duration: 1,
        mods: { tnDice: "-1d10", defPenaltyDice: "-1d10" }
      });
      return buildDetail("-1d10 TN / -1d10 soak (1 round)");
    }
  },
  {
    key: "friendly-fire",
    title: "Friendly Fire",
    text: "Stray shots tear through the ranks.",
    apply: async actor => {
      const roll = await rollFormula("1d10");
      const change = await adjustHP(actor, -roll.total);
      return buildDetail(`-${Math.abs(Math.round(change))} HP (${roll.formula})`);
    }
  },
  {
    key: "lost-focus",
    title: "Lost Focus",
    text: "The unit struggles to execute maneuvers.",
    apply: async actor => {
      await addEffect(actor, {
        key: "hob-lost-focus",
        label: "Lost Focus",
        duration: 1,
        mods: { maneuverTNDice: "-4d10" }
      });
      return buildDetail("-4d10 Maneuver TN (1 round)");
    }
  },
  {
    key: "frayed-nerve",
    title: "Frayed Nerve",
    text: "Anxious whispers ripple through the troops.",
    apply: async actor => {
      const roll = await rollFormula("1d10");
      const change = await adjustMorale(actor, -roll.total);
      await addEffect(actor, {
        key: "hob-frayed-nerve",
        label: "Frayed Nerve",
        duration: 1,
        mods: { defPenaltyDice: "-1d10" }
      });
      return buildDetail(`-${Math.abs(Math.round(change))} Morale (${roll.formula})`);
    }
  }
];

const HP_EVENTS = [
  {
    key: "bloody-surge",
    title: "Bloody Surge",
    text: "Pain turns to fury.",
    apply: async actor => {
      const dmgRoll = await rollFormula("2d10");
      await addEffect(actor, {
        key: "hob-bloody-surge",
        label: "Bloody Surge",
        duration: 1,
        mods: { dmgDice: "+2d10" }
      });
      return buildDetail("+2d10 damage (1 round)", { damage: [immediateFromRoll(dmgRoll)] });
    }
  },
  {
    key: "field-medic",
    title: "Field Medic",
    text: "A quick patch-up stabilises the squad.",
    apply: async actor => {
      const roll = await rollFormula("1d20");
      const change = await adjustHP(actor, roll.total);
      return buildDetail(`+${Math.max(0, Math.round(change))} HP (${roll.formula})`);
    }
  },
  {
    key: "stalled-advance",
    title: "Stalled Advance",
    text: "Losses halt the push forward.",
    apply: async actor => {
      const tnRoll = await rollFormula("1d20");
      await addEffect(actor, {
        key: "hob-stalled-advance",
        label: "Stalled Advance",
        duration: 2,
        mods: { tnDice: "-1d20" }
      });
      return buildDetail("-1d20 TN (2 rounds)", { tn: [immediateFromRoll(tnRoll)] });
    }
  },
  {
    key: "dig-in",
    title: "Dig In",
    text: "The squad braces behind makeshift cover.",
    apply: async actor => {
      await addEffect(actor, {
        key: "hob-dig-in",
        label: "Dig In",
        duration: 2,
        mods: { defSoakDice: "+3d10", rangedResistDice: "+2d10" }
      });
      return buildDetail("+3d10 soak / +2d10 ranged resist (2 rounds)");
    }
  },
  {
    key: "desperate-stand",
    title: "Desperate Stand",
    text: "There is nowhere to fall back.",
    apply: async actor => {
      await clearNegative(actor);
      await addEffect(actor, {
        key: "hob-desperate-stand",
        label: "Desperate Stand",
        duration: 1,
        mods: { defSoakDice: "+2d10", tnDice: "+1d10" }
      });
      return buildDetail("Remove penalties, +2d10 soak / +1d10 TN (1 round)");
    }
  },
  {
    key: "fighting-retreat",
    title: "Fighting Retreat",
    text: "The unit yields ground in good order.",
    apply: async actor => {
      await addEffect(actor, {
        key: "hob-fighting-retreat",
        label: "Fighting Retreat",
        duration: 1,
        mods: { defSoakDice: "+1d10", tags: { disengaged: true } }
      });
      return buildDetail("Disengaged & +1d10 soak (1 round)");
    }
  },
  {
    key: "grim-resolve",
    title: "Grim Resolve",
    text: "Wounds only harden their focus.",
    apply: async actor => {
      const tnRoll = await rollFormula("1d10");
      const dmgRoll = await rollFormula("1d10");
      await addEffect(actor, {
        key: "hob-grim-resolve",
        label: "Grim Resolve",
        duration: 1,
        mods: { tnDice: "+1d10", dmgDice: "+1d10" }
      });
      return buildDetail("+1d10 TN / +1d10 damage (1 round)", {
        tn: [immediateFromRoll(tnRoll)],
        damage: [immediateFromRoll(dmgRoll)]
      });
    }
  },
  {
    key: "painful-losses",
    title: "Painful Losses",
    text: "Seeing the fallen chills morale.",
    apply: async actor => {
      const roll = await rollFormula("2d10");
      const change = await adjustMorale(actor, -roll.total);
      return buildDetail(`-${Math.abs(Math.round(change))} Morale (${roll.formula})`);
    }
  },
  {
    key: "reinforced-lines",
    title: "Reinforced Lines",
    text: "Fresh bodies plug the gaps.",
    apply: async actor => {
      const roll = await rollFormula("2d10");
      const change = await adjustHP(actor, roll.total);
      await addEffect(actor, {
        key: "hob-reinforced-lines",
        label: "Reinforced Lines",
        duration: 1,
        mods: { defSoakDice: "+1d10" }
      });
      return buildDetail(`+${Math.max(0, Math.round(change))} HP (${roll.formula})`);
    }
  },
  {
    key: "reckless-counter",
    title: "Reckless Counter",
    text: "A desperate counterattack leaves them exposed.",
    apply: async actor => {
      const dmgRoll = await rollFormula("2d10");
      await addEffect(actor, {
        key: "hob-reckless-counter",
        label: "Reckless Counter",
        duration: 1,
        mods: { dmgDice: "+2d10", defPenaltyDice: "-1d10" }
      });
      return buildDetail("+2d10 damage / -1d10 soak (1 round)", { damage: [immediateFromRoll(dmgRoll)] });
    }
  }
];

const MORALE_EVENTS = [
  {
    key: "banner-raised",
    title: "Banner Raised",
    text: "Standard held high steels the line.",
    apply: async actor => {
      const roll = await rollFormula("2d20");
      const change = await adjustMorale(actor, roll.total);
      return buildDetail(`+${Math.max(0, Math.round(change))} Morale (${roll.formula})`);
    }
  },
  {
    key: "panic-ripple",
    title: "Panic Ripple",
    text: "Fear spreads across the unit.",
    apply: async actor => {
      const roll = await rollFormula("2d20");
      const change = await adjustMorale(actor, -roll.total);
      await addEffect(actor, {
        key: "hob-panic",
        label: "Disorganized",
        duration: 1,
        mods: { defPenaltyDice: "-1d20", tags: { disorganized: true } }
      });
      return buildDetail(`-${Math.abs(Math.round(change))} Morale (${roll.formula}) & Disorganized`);
    }
  },
  {
    key: "heroic-stand",
    title: "Heroic Stand",
    text: "A champion steps forward to inspire bravery.",
    apply: async actor => {
      const tnRoll = await rollFormula("1d20");
      const dmgRoll = await rollFormula("1d10");
      await addEffect(actor, {
        key: "hob-heroic-stand",
        label: "Heroic Stand",
        duration: 1,
        mods: { tnDice: "+1d20", dmgDice: "+1d10" }
      });
      return buildDetail("+1d20 TN / +1d10 damage (1 round)", {
        tn: [immediateFromRoll(tnRoll)],
        damage: [immediateFromRoll(dmgRoll)]
      });
    }
  },
  {
    key: "rally-colors",
    title: "Rally to the Colors",
    text: "Soldiers flock back to the banner.",
    apply: async actor => {
      await clearNegative(actor);
      const roll = await rollFormula("1d10");
      const change = await adjustMorale(actor, roll.total);
      return buildDetail(`Remove penalties, +${Math.max(0, Math.round(change))} Morale (${roll.formula})`);
    }
  },
  {
    key: "gloom-spreads",
    title: "Gloom Spreads",
    text: "Rumours of defeat sap strength.",
    apply: async actor => {
      const roll = await rollFormula("1d20");
      const change = await adjustMorale(actor, -roll.total);
      await addEffect(actor, {
        key: "hob-gloom-spreads",
        label: "Gloom Spreads",
        duration: 1,
        mods: { tnDice: "-1d10" }
      });
      return buildDetail(`-${Math.abs(Math.round(change))} Morale (${roll.formula}) & -1d10 TN (1 round)`);
    }
  },
  {
    key: "grim-determination",
    title: "Grim Determination",
    text: "Despair hardens into resolve.",
    apply: async actor => {
      await addEffect(actor, {
        key: "hob-grim-determination",
        label: "Grim Determination",
        duration: 2,
        mods: { defSoakDice: "+2d10" }
      });
      return buildDetail("+2d10 soak (2 rounds)");
    }
  },
  {
    key: "battle-hymn",
    title: "Battle Hymn",
    text: "A rousing song lifts spirits.",
    apply: async actor => {
      await addEffect(actor, {
        key: "hob-battle-hymn",
        label: "Battle Hymn",
        duration: 1,
        mods: { maneuverTNDice: "+4d10" }
      });
      return buildDetail("+4d10 Maneuver TN (1 round)");
    }
  },
  {
    key: "steel-nerves",
    title: "Steel Your Nerves",
    text: "Veterans bark reminders to hold steady.",
    apply: async actor => {
      const tnRoll = await rollFormula("1d10");
      await addEffect(actor, {
        key: "hob-steel-nerves",
        label: "Steel Nerves",
        duration: 1,
        mods: { tnDice: "+1d10" }
      });
      return buildDetail("+1d10 TN (1 round)", { tn: [immediateFromRoll(tnRoll)] });
    }
  },
  {
    key: "rumors-retreat",
    title: "Rumours of Retreat",
    text: "Doubt gnaws at the formation.",
    apply: async actor => {
      const roll = await rollFormula("1d20");
      const change = await adjustMorale(actor, -roll.total);
      await addEffect(actor, {
        key: "hob-rumors-retreat",
        label: "Rumours of Retreat",
        duration: 1,
        mods: { defPenaltyDice: "-1d10" }
      });
      return buildDetail(`-${Math.abs(Math.round(change))} Morale (${roll.formula}) & -1d10 soak (1 round)`);
    }
  },
  {
    key: "steady-drum",
    title: "Steady Drum",
    text: "Rhythmic beats keep the pace.",
    apply: async actor => {
      const roll = await rollFormula("1d10");
      const change = await adjustMorale(actor, roll.total);
      await addEffect(actor, {
        key: "hob-steady-drum",
        label: "Steady Drum",
        duration: 1,
        mods: { defSoakDice: "+1d10" }
      });
      return buildDetail(`+${Math.max(0, Math.round(change))} Morale (${roll.formula}) & +1d10 soak (1 round)`);
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
  }

  return { notes, tnAdjustments, damageAdjustments };
}
