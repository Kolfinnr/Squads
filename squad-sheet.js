import { SHEET_PATH, FLAG_SCOPE, WEAPONS, ROLES } from "../config.js";
import { doSquadAction } from "../features/actions.js";
import { openManeuverDialog } from "../features/maneuver-action.js";

export class SquadActorSheet extends ActorSheet {
  static get defaultOptions() {
    const o = super.defaultOptions;
    o.classes = ["w4sq", "sheet", "actor"];
    o.template = SHEET_PATH;
    o.width = 720;
    o.height = 560;
    o.submitOnChange = true;
    o.closeOnSubmit = false;
    return o;
  }

  async getData(options) {
    const data = await super.getData(options);
    const f = (k, d) => this.actor.getFlag(FLAG_SCOPE, k) ?? d;

    data.squad = {
      hp: f("hp", 100), hpMax: f("hpMax", 100),
      morale: f("morale", 100), moraleMax: f("moraleMax", 100),
      experienceTier: f("experienceTier", 0),
      equipmentTier: f("equipmentTier", 0),
      role: f("role", "infantry"),
      weapon: f("weapon", "sword"),
      notes: f("notes", "")
    };

    // <-- THESE TWO LINES WERE MISSING
    data.roles = ROLES;
    data.weapons = WEAPONS;

    return data;
  }

  _bindFlagInputs(html) {
    const selector = `[name^="flags.${FLAG_SCOPE}"]`;
    html.find(selector).on("change", async ev => {
      const el = ev.currentTarget;
      const dtype = el.dataset.dtype;
      let value = el.value;
      if (dtype === "Number") value = Number(value || 0);
      if (dtype === "Boolean") value = !!el.checked;
      await this.actor.update({ [el.name]: value });
    });
  }

  async activateListeners(html) {
    super.activateListeners(html);
    this._bindFlagInputs(html);

    html.find('button[data-action="melee"]').on("click", () => doSquadAction(this.actor, "melee"));
    html.find('button[data-action="ranged"]').on("click", () => doSquadAction(this.actor, "ranged"));
    html.find('button[data-action="maneuver"]').on("click", () => openManeuverDialog(this.actor));
  }
}
