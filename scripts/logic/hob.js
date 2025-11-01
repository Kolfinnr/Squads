import { FLAG_SCOPE, SETTINGS, MODULE_ID } from "../config.js";
import { addEffect } from "./effects.js";

const goodDouble = [
  {
    key: "critical-push",
    title: "Critical Push",
    text: "Momentum surges forward.",
    apply: async actor => {
      await addEffect(actor, {
        key: "hob-critical-push",
        label: "Critical Push",
        duration: 1,
        mods: { tnDice: "+2d10", dmgDice: "+2d10" }
      });
      const tnRoll = await (new Roll("2d10").roll({ async: true }));
      const dmgRoll = await (new Roll("2d10").roll({ async: true }));
      return {
        summary: "+2d10 TN / +2d10 damage (1 round)",
        immediate: {
          tn: { total: tnRoll.total, formula: tnRoll.formula },
          damage: { total: dmgRoll.total, formula: dmgRoll.formula }
        }
      };
    }
  },
  {
    key: "killer-instinct",
    title: "Killer Instinct",
    text: "Every strike lands with ruthless precision.",
    apply: async actor => {
      await addEffect(actor, {
        key: "hob-killer-instinct",
        label: "Killer Instinct",
        duration: 1,
        mods: { dmgDice: "+2d10" }
      });
      const dmgRoll = await (new Roll("2d10").roll({ async: true }));
      return {
        summary: "+2d10 damage (1 round)",
        immediate: {
          damage: { total: dmgRoll.total, formula: dmgRoll.formula }
        }
      };
    }
  }
];

const badDouble = [
  {
    key: "officer-down",
    title: "Officer Down",
    text: "The line staggers as leadership falters.",
    apply: async actor => {
      const morale = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
      const roll = await (new Roll("1d20").roll({ async: true }));
      await actor.setFlag(FLAG_SCOPE, "morale", Math.max(0, morale - roll.total));
      return `-${roll.total} Morale`;
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
      return "Disorganized (1 round)";
    }
  }
];

const hpEvents = [
  {
    key: "bloody-surge",
    title: "Bloody Surge",
    text: "Pain turns to fury.",
    apply: async actor => {
      await addEffect(actor, {
        key: "hob-bloody-surge",
        label: "Bloody Surge",
        duration: 1,
        mods: { dmgDice: "+2d10" }
      });
      const dmgRoll = await (new Roll("2d10").roll({ async: true }));
      return {
        summary: "+2d10 damage (1 round)",
        immediate: {
          damage: { total: dmgRoll.total, formula: dmgRoll.formula }
        }
      };
    }
  },
  {
    key: "field-medic",
    title: "Field Medic",
    text: "A quick patch-up stabilises the squad.",
    apply: async actor => {
      const hp = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
      const hpMax = Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 0);
      const roll = await (new Roll("1d20").roll({ async: true }));
      const next = Math.min(hpMax, hp + roll.total);
      await actor.setFlag(FLAG_SCOPE, "hp", next);
      return `+${roll.total} HP`;
    }
  }
];

const moraleEvents = [
  {
    key: "banner-raised",
    title: "Banner Raised",
    text: "Standard held high steels the line.",
    apply: async actor => {
      const morale = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
      const moraleMax = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 0);
      const roll = await (new Roll("2d20").roll({ async: true }));
      await actor.setFlag(FLAG_SCOPE, "morale", Math.min(moraleMax, morale + roll.total));
      return `+${roll.total} Morale`;
    }
  },
  {
    key: "panic-ripple",
    title: "Panic Ripple",
    text: "Fear spreads across the unit.",
    apply: async actor => {
      await addEffect(actor, {
        key: "hob-panic",
        label: "Disorganized",
        duration: 1,
        mods: { defPenaltyDice: "-1d20", tags: { disorganized: true } }
      });
      const morale = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
      const roll = await (new Roll("2d20").roll({ async: true }));
      await actor.setFlag(FLAG_SCOPE, "morale", Math.max(0, morale - roll.total));
      return `-${roll.total} Morale & Disorganized (1 round)`;
    }
  }
];

function randomEntry(pool) {
  if (!Array.isArray(pool) || !pool.length) return null;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx] ?? null;
}

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeAdjustment(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") {
    return { total: value, formula: "" };
  }
  if (typeof value === "object") {
    const total = Number(value.total ?? value.value ?? value.amount ?? 0);
    if (!Number.isFinite(total)) return null;
    const formula = value.formula ?? value.expr ?? value.expression ?? value.dice ?? "";
    return { total, formula };
  }
  return null;
}

function normalizeImmediate(immediate) {
  if (!immediate || typeof immediate !== "object") {
    return { tn: [], damage: [] };
  }
  return {
    tn: toArray(immediate.tn).map(normalizeAdjustment).filter(Boolean),
    damage: toArray(immediate.damage).map(normalizeAdjustment).filter(Boolean)
  };
}

function normalizeDetail(detail) {
  if (!detail) {
    return { summary: null, immediate: { tn: [], damage: [] } };
  }
  if (typeof detail === "string") {
    return { summary: detail, immediate: { tn: [], damage: [] } };
  }
  return {
    summary: detail.summary ?? null,
    immediate: normalizeImmediate(detail.immediate)
  };
}

function describeImmediate(immediate) {
  const tnAdjustments = [];
  const damageAdjustments = [];
  const strings = [];

  for (const item of immediate.tn ?? []) {
    tnAdjustments.push(item);
    strings.push(game.i18n.format("W4SQ.ChatHoBTn", { total: item.total, formula: item.formula || "" }));
  }
  for (const item of immediate.damage ?? []) {
    damageAdjustments.push(item);
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

export async function maybeTriggerHoB(actor, { roll, success, type } = {}) {
  if (!game.settings.get(MODULE_ID, SETTINGS.enableHoB)) return null;
  const results = [];
  const context = { type };

  const isDouble = roll >= 11 && roll <= 99 && roll % 11 === 0;
  if (isDouble) {
    const heading = success ? game.i18n.localize("W4SQ.HoBGood") : game.i18n.localize("W4SQ.HoBBad");
    const event = await resolveEvent(actor, success ? goodDouble : badDouble, heading, context);
    if (event) results.push(event);
  }

  const hp = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
  const hpMax = Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 0);
  const morale = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
  const moraleMax = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 0);

  if (hpMax > 0 && hp / hpMax <= 0.3 && !actor.getFlag(FLAG_SCOPE, "hob_hp30")) {
    await actor.setFlag(FLAG_SCOPE, "hob_hp30", true);
    const heading = game.i18n.localize("W4SQ.HoBLowHP");
    const event = await resolveEvent(actor, hpEvents, heading, { ...context, threshold: "hp" });
    if (event) results.push(event);
  }

  if (moraleMax > 0 && morale / moraleMax <= 0.3 && !actor.getFlag(FLAG_SCOPE, "hob_mo30")) {
    await actor.setFlag(FLAG_SCOPE, "hob_mo30", true);
    const heading = game.i18n.localize("W4SQ.HoBLowMorale");
    const event = await resolveEvent(actor, moraleEvents, heading, { ...context, threshold: "morale" });
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
