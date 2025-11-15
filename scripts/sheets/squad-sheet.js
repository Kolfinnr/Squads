import { FLAG_SCOPE, SHEET_TEMPLATE, WEAPONS, ROLES, DEFAULT_FLAGS, SPECIALIST_TYPES } from "../config.js";
import { doSquadAction } from "../features/actions.js";
import { openManeuverDialog } from "../features/maneuver-action.js";
import { getEffectsDetailed } from "../logic/effects.js";
import { getCooldown, mergeCooldownEntries } from "../logic/cooldowns.js";
import { maneuversFor } from "../logic/maneuvers.js";
import { openCommandDashboard } from "../features/command-dashboard.js";
import { ORIGIN_KEYS, getOriginLabelKey, getPassiveLabel, getOriginPassivesFor } from "../logic/origins.js";

function formatTurns(value) {
  const turns = Math.max(0, Number(value || 0));
  if (turns === 1) return game.i18n.localize("W4SQ.TurnSingle");
  return game.i18n.format("W4SQ.TurnPlural", { value: turns });
}

export class SquadActorSheet extends ActorSheet {
  static get defaultOptions() {
    const opts = super.defaultOptions;
    opts.classes = ["w4sq", "sheet", "actor"];
    opts.template = SHEET_TEMPLATE;
    opts.width = 700;
    opts.height = 640;
    opts.submitOnChange = true;
    opts.closeOnSubmit = false;
    opts.tabs = [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "main" }];
    return opts;
  }

  async getData(options) {
    const data = await super.getData(options);
    const f = (key, fallback = null) => this.actor.getFlag(FLAG_SCOPE, key) ?? fallback;
    const role = f("role", "infantry");
    const squadSystem = foundry.utils.getProperty(this.actor.system ?? this.actor.data?.data, "squad") || {};
    const origin = squadSystem.origin ?? "";
    const passiveState = squadSystem.passives ?? {};
    data.squad = {
      hp: f("hp", 100),
      hpMax: f("hpMax", 100),
      morale: f("morale", 50),
      moraleMax: f("moraleMax", 100),
      experienceTier: f("experienceTier", 0),
      equipmentTier: f("equipmentTier", 0),
      role,
      weapon: role === "specialist" ? null : f("weapon", "sword"),
      specialistType: f("specialistType", null),
      notes: f("notes", ""),
      fear: f("fear", false),
      terror: f("terror", false),
      unbreakable: f("unbreakable", false),
      backlineAttack: f("backlineAttack", false),
      playerControlled: f("playerControlled", null),
      isCommander: f("isCommander", false),
      cp: foundry.utils.duplicate(f("cp", DEFAULT_FLAGS.cp)),
      lastTargetName: f("lastTargetName", ""),
      origin,
      passives: passiveState
    };
    const effectDetails = getEffectsDetailed(this.actor);
    const activeEffects = [];
    const passiveEffects = [];
    for (const effect of effectDetails) {
      const isPassive = Boolean(effect?.mods?.tags?.passive);
      const entry = {
        ...effect,
        durationLabel: isPassive
          ? game.i18n.localize("W4SQ.PassiveEffectDuration")
          : formatTurns(effect.duration ?? 0)
      };
      if (isPassive) passiveEffects.push(entry);
      else activeEffects.push(entry);
    }
    data.effects = activeEffects;
    data.activeEffects = activeEffects;
    data.passiveEffects = passiveEffects;

    const specialistExtras = [];
    if (role === "specialist") {
      for (const maneuver of maneuversFor(this.actor)) {
        if (maneuver.category !== "specialist") continue;
        const remaining = getCooldown(this.actor, maneuver.key);
        if (remaining > 0) {
          specialistExtras.push({ key: maneuver.key, label: maneuver.name, rounds: remaining });
        }
      }
    }
    data.cooldowns = mergeCooldownEntries(this.actor, specialistExtras);
    data.roles = ROLES;
    data.weapons = WEAPONS;
    data.specialistTypes = SPECIALIST_TYPES;
    data.originOptions = ORIGIN_KEYS.map(key => ({
      key,
      label: game.i18n.localize(getOriginLabelKey(key))
    }));
    const originPassiveKeys = getOriginPassivesFor(origin) || [];
    data.originPassives = originPassiveKeys.map(key => ({
      key,
      label: game.i18n.localize(getPassiveLabel(key)),
      checked: Boolean(passiveState?.[key])
    }));
    return data;
  }

  _bindFlagInputs(html) {
    const selector = `[name^="flags.${FLAG_SCOPE}"]`;
    html.querySelectorAll(selector).forEach(el => {
      el.addEventListener("change", async ev => {
        const input = ev.currentTarget;
        const dtype = input.dataset.dtype;
        let value = input.value;
        if (dtype === "Number") value = Number(value || 0);
        if (dtype === "Boolean" || input.type === "checkbox") value = input.checked;
        if (input.dataset.nullable === "true") {
          if (value === "") value = null;
          if (value === "true") value = true;
          if (value === "false") value = false;
        }
        const update = { [input.name]: value };
        if (input.name === `flags.${FLAG_SCOPE}.role`) {
          if (value === "specialist") {
            update[`flags.${FLAG_SCOPE}.weapon`] = null;
          } else {
            const current = this.actor.getFlag(FLAG_SCOPE, "weapon");
            if (!current) {
              update[`flags.${FLAG_SCOPE}.weapon`] = DEFAULT_FLAGS.weapon;
            }
          }
        }
        if (input.name === `flags.${FLAG_SCOPE}.specialistType` && value === "") {
          update[input.name] = null;
        }
        await this.actor.update(update);
      });
    });
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0] ?? html;
    this._bindFlagInputs(root);
    this._bindSystemInputs(root);

    html.find('button[data-action="melee"]').on("click", () => doSquadAction(this.actor, "melee"));
    html.find('button[data-action="ranged"]').on("click", () => doSquadAction(this.actor, "ranged"));
    html.find('button[data-action="maneuver"]').on("click", () => openManeuverDialog(this.actor));
    html.find('button[data-action="command"]').on("click", () => openCommandDashboard(this.actor));
  }

  _bindSystemInputs(root) {
    if (!root) return;
    root.querySelectorAll('[name^="system.squad."]').forEach(el => {
      el.addEventListener("change", async ev => {
        const input = ev.currentTarget;
        const path = input.name;
        let value;
        if (input.type === "checkbox") {
          value = input.checked;
        } else if (input.dataset.dtype === "Number") {
          value = Number(input.value || 0);
        } else {
          value = input.value;
        }
        if (input.dataset.nullable === "true" && value === "") {
          value = null;
        }
        try {
          await this.actor.update({ [path]: value });
        } catch (err) {
          console.error(`wfrp4e-squads | Failed to update ${path}`, err);
        }
      });
    });
  }
}
