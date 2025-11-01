import { FLAG_SCOPE, SHEET_TEMPLATE, WEAPONS, ROLES, DEFAULT_FLAGS } from "../config.js";
import { doSquadAction } from "../features/actions.js";
import { openManeuverDialog } from "../features/maneuver-action.js";
import { getEffectsDetailed } from "../logic/effects.js";
import { getCooldowns } from "../logic/cooldowns.js";
import { openCommandDashboard } from "../features/command-dashboard.js";

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
    data.squad = {
      hp: f("hp", 100),
      hpMax: f("hpMax", 100),
      morale: f("morale", 50),
      moraleMax: f("moraleMax", 100),
      experienceTier: f("experienceTier", 0),
      equipmentTier: f("equipmentTier", 0),
      role: f("role", "infantry"),
      weapon: f("weapon", "sword"),
      notes: f("notes", ""),
      fear: f("fear", false),
      terror: f("terror", false),
      unbreakable: f("unbreakable", false),
      playerControlled: f("playerControlled", null),
      isCommander: f("isCommander", false),
      cp: foundry.utils.duplicate(f("cp", DEFAULT_FLAGS.cp)),
      lastTargetName: f("lastTargetName", "")
    };
    data.effects = getEffectsDetailed(this.actor);
    data.cooldowns = getCooldowns(this.actor);
    data.roles = ROLES;
    data.weapons = WEAPONS;
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
        await this.actor.update({ [input.name]: value });
      });
    });
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._bindFlagInputs(html[0] ?? html);

    html.find('button[data-action="melee"]').on("click", () => doSquadAction(this.actor, "melee"));
    html.find('button[data-action="ranged"]').on("click", () => doSquadAction(this.actor, "ranged"));
    html.find('button[data-action="maneuver"]').on("click", () => openManeuverDialog(this.actor));
    html.find('button[data-action="command"]').on("click", () => openCommandDashboard(this.actor));
  }
}
