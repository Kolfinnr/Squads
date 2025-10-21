import { FLAG_SCOPE, MODULE_ID } from "../config.js";
import { doSquadAction } from "./actions.js";
import { addEffect, clearNegative, getEffects } from "../logic/effects.js";
import { getCooldowns, setCooldown } from "../logic/cooldowns.js";

const TEMPLATE = `modules/${MODULE_ID}/templates/command-dashboard.hbs`;

function canSee(actor) {
  if (game.user.isGM) return true;
  const pc = actor.getFlag(FLAG_SCOPE, "playerControlled");
  if (pc === true) return true;
  if (pc === false) return false;
  if (actor.isOwner) return true;
  return actor?.attitude === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
}

function getCP(actor) {
  const cp = actor?.getFlag(FLAG_SCOPE, "cp") ?? { current: 0, cap: 0 };
  return { current: Number(cp.current || 0), cap: Number(cp.cap || 0) };
}

export class W4SQCommandApp extends Application {
  static instances = new Map();

  static closeAll() {
    for (const inst of this.instances.values()) {
      inst.close();
    }
    this.instances.clear();
  }

  static open(actor) {
    let instance = this.instances.get(game.user.id);
    if (!instance) {
      instance = new W4SQCommandApp(actor);
      this.instances.set(game.user.id, instance);
    } else if (actor) {
      instance.contextActor = actor;
      instance.selectedSquadId = actor.id;
    }
    instance.render(true);
    return instance;
  }

  constructor(actor) {
    super({ template: TEMPLATE, classes: ["w4sq", "command-app"] });
    this.contextActor = actor;
    this.selectedSquadId = actor?.id ?? null;
  }

  get title() {
    return game.i18n.localize("W4SQ.CommandDashboard");
  }

  _getCommander() {
    const all = game.actors?.contents ?? [];
    let commander = all.find(a => a.getFlag(FLAG_SCOPE, "isCommander"));
    if (!commander) commander = this.contextActor;
    return commander;
  }

  _getVisibleSquads() {
    const actors = game.actors?.contents ?? [];
    return actors.filter(a => a.getFlag(FLAG_SCOPE, "hp") !== undefined && canSee(a));
  }

  async getData() {
    const commander = this._getCommander();
    const cp = getCP(commander);
    const squads = this._getVisibleSquads().map(actor => {
      const hp = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
      const hpMax = Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 0);
      const morale = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
      const moraleMax = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 0);
      return {
        id: actor.id,
        name: actor.name,
        hp,
        hpMax,
        hpPct: hpMax > 0 ? Math.round((hp / hpMax) * 100) : 0,
        morale,
        moraleMax,
        moralePct: moraleMax > 0 ? Math.round((morale / moraleMax) * 100) : 0,
        effects: getEffects(actor),
        cooldowns: Object.entries(getCooldowns(actor)),
        lastTargetName: actor.getFlag(FLAG_SCOPE, "lastTargetName") || "",
        order: actor.getFlag(FLAG_SCOPE, "order") || "",
        isSelected: this.selectedSquadId === actor.id
      };
    });

    if (!this.selectedSquadId && squads.length) {
      this.selectedSquadId = squads[0].id;
      squads[0].isSelected = true;
    }

    return {
      commander,
      cp,
      squads
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find('[data-action="select"]').on("click", ev => {
      const id = ev.currentTarget.dataset.id;
      this.selectedSquadId = id;
      this.render();
    });

    html.find('[data-command]').on("click", async ev => {
      const cmd = ev.currentTarget.dataset.command;
      await this._handleCommand(cmd);
    });
  }

  _getSelectedActor() {
    const id = this.selectedSquadId;
    if (!id) return null;
    return game.actors?.get(id) ?? game.actors?.contents?.find(a => a.id === id) ?? null;
  }

  async _handleCommand(cmd) {
    const commander = this._getCommander();
    const squad = this._getSelectedActor();
    if (!squad) {
      ui.notifications.warn(game.i18n.localize("W4SQ.SelectSquad"));
      return;
    }
    switch (cmd) {
      case "cmd-ranged":
        await this._commandRanged(commander, squad);
        break;
      case "cmd-orders":
        await this._commandOrders(commander, squad);
        break;
      case "cmd-reorg":
        await this._commandReorg(commander, squad);
        break;
      case "cmd-rally":
        await this._commandRally(commander, squad);
        break;
      case "cmd-withdraw":
        await this._commandWithdraw(commander, squad);
        break;
      case "cmd-special":
        await this._commandSpecial(commander, squad);
        break;
      case "cmd-formation":
        await this._commandFormation(commander, squad);
        break;
    }
    this.render();
  }

  async _spendCP(commander, amount) {
    if (!commander) return false;
    const cp = getCP(commander);
    if (cp.current < amount) {
      ui.notifications.warn(game.i18n.localize("W4SQ.NotEnoughCP"));
      return false;
    }
    cp.current = Math.max(0, cp.current - amount);
    await commander.setFlag(FLAG_SCOPE, "cp", cp);
    return true;
  }

  async _commandRanged(commander, squad) {
    if (!(await this._spendCP(commander, 2))) return;
    await doSquadAction(squad, "ranged");
    await setCooldown(squad, "cmdRangedPreempt", 1);
  }

  async _commandOrders(commander, squad) {
    const options = {
      melee: game.i18n.localize("W4SQ.OrderMelee"),
      ranged: game.i18n.localize("W4SQ.OrderRanged"),
      maneuver: game.i18n.localize("W4SQ.OrderManeuver"),
      hold: game.i18n.localize("W4SQ.OrderHold")
    };
    const content = `<div class="w4sq-orders">${Object.entries(options).map(([key, label]) => `<label><input type="radio" name="order" value="${key}">${label}</label>`).join("<br/>")}</div>`;
    const choice = await Dialog.prompt({
      title: game.i18n.localize("W4SQ.NewOrders"),
      content,
      label: game.i18n.localize("W4SQ.Confirm"),
      callback: html => html.querySelector('input[name="order"]:checked')?.value
    });
    if (!choice) return;
    if (!(await this._spendCP(commander, 1))) return;
    await squad.setFlag(FLAG_SCOPE, "order", choice);
  }

  async _commandReorg(commander, squad) {
    if (!(await this._spendCP(commander, 1))) return;
    await clearNegative(squad);
    const roll = await (new Roll("2d20").roll({ async: true }));
    const morale = Number(squad.getFlag(FLAG_SCOPE, "morale") || 0);
    const moraleMax = Number(squad.getFlag(FLAG_SCOPE, "moraleMax") || 0);
    await squad.setFlag(FLAG_SCOPE, "morale", Math.min(moraleMax, morale + roll.total));
  }

  async _commandRally(commander, squad) {
    if (!(await this._spendCP(commander, 1))) return;
    const roll = await (new Roll("1d20").roll({ async: true }));
    const morale = Number(squad.getFlag(FLAG_SCOPE, "morale") || 0);
    const moraleMax = Number(squad.getFlag(FLAG_SCOPE, "moraleMax") || 0);
    await squad.setFlag(FLAG_SCOPE, "morale", Math.min(moraleMax, morale + roll.total));
  }

  async _commandWithdraw(commander, squad) {
    if (!(await this._spendCP(commander, 1))) return;
    const effects = getEffects(squad).filter(e => {
      const tags = e?.mods?.tags ?? {};
      return !tags.flanked && !tags.encircled;
    });
    await squad.setFlag(FLAG_SCOPE, "effects", effects);
    await addEffect(squad, {
      key: "cmd-withdraw",
      label: "Withdraw",
      duration: 1,
      mods: { defSoakDice: "+1d10", tags: { disengaged: true } }
    });
  }

  async _commandSpecial(commander, squad) {
    const text = await Dialog.prompt({
      title: game.i18n.localize("W4SQ.SpecialAction"),
      content: `<textarea rows="4" style="width:100%"></textarea>`,
      label: game.i18n.localize("W4SQ.Confirm"),
      callback: html => html.querySelector("textarea")?.value?.trim()
    });
    if (!text) return;
    if (!(await this._spendCP(commander, 1))) return;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: squad }),
      content: `<p><strong>${game.i18n.localize("W4SQ.SpecialAction")}</strong>: ${text}</p>`
    });
  }

  async _commandFormation(commander, squad) {
    if (!(await this._spendCP(commander, 2))) return;
    await addEffect(squad, {
      key: "cmd-formation",
      label: "Get in Formation!",
      duration: 1,
      mods: { maneuverTNDice: "+8d10" }
    });
  }
}

export function openCommandDashboard(actor) {
  return W4SQCommandApp.open(actor);
}
