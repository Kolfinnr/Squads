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
      return "+2d10 TN / +2d10 damage (1 round)";
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
      return "+2d10 damage (1 round)";
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
      return "+2d10 damage (1 round)";
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

async function chooseEvent(actor, pool, heading) {
  const buttons = {};
  for (const entry of pool) {
    buttons[entry.key] = {
      label: entry.title,
      callback: () => entry
    };
  }
  return Dialog.wait({
    title: `${heading}: ${actor.name}`,
    content: `<p>${game.i18n.localize("W4SQ.HoBPrompt")}</p>`,
    buttons,
    default: Object.keys(buttons)[0]
  }, { width: 400 });
}

async function applyEvent(actor, entry, heading) {
  if (!entry) return;
  const detail = await entry.apply?.(actor);
  const extra = detail ? `<br/><em>${detail}</em>` : "";
  const content = `<h3>${heading}</h3><p><strong>${entry.title}</strong> – ${entry.text}${extra}</p>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });
}

export async function maybeTriggerHoB(actor, { roll, success }) {
  if (!game.settings.get(MODULE_ID, SETTINGS.enableHoB)) return;
  const isDouble = roll >= 11 && roll <= 99 && roll % 11 === 0;
  if (isDouble) {
    const heading = success ? game.i18n.localize("W4SQ.HoBGood") : game.i18n.localize("W4SQ.HoBBad");
    const entry = await chooseEvent(actor, success ? goodDouble : badDouble, heading);
    await applyEvent(actor, entry, heading);
  }

  const hp = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
  const hpMax = Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 0);
  const morale = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
  const moraleMax = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 0);

  if (hpMax > 0 && hp / hpMax <= 0.3 && !actor.getFlag(FLAG_SCOPE, "hob_hp30")) {
    await actor.setFlag(FLAG_SCOPE, "hob_hp30", true);
    const heading = game.i18n.localize("W4SQ.HoBLowHP");
    const entry = await chooseEvent(actor, hpEvents, heading);
    await applyEvent(actor, entry, heading);
  }

  if (moraleMax > 0 && morale / moraleMax <= 0.3 && !actor.getFlag(FLAG_SCOPE, "hob_mo30")) {
    await actor.setFlag(FLAG_SCOPE, "hob_mo30", true);
    const heading = game.i18n.localize("W4SQ.HoBLowMorale");
    const entry = await chooseEvent(actor, moraleEvents, heading);
    await applyEvent(actor, entry, heading);
  }
}
