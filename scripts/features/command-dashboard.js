import { FLAG_SCOPE, MODULE_ID, DEFAULT_FLAGS } from "../config.js";
import { doSquadAction } from "./actions.js";
import { addEffect, clearNegative, getEffects } from "../logic/effects.js";
import { getCooldown, getCooldowns, setCooldown } from "../logic/cooldowns.js";

const TEMPLATE = `modules/${MODULE_ID}/templates/command-dashboard.hbs`;

const STANDING_ORDER_OPTIONS = [
  { value: "", label: "W4SQ.OrderNone" },
  { value: "move", label: "W4SQ.OrderMove" },
  { value: "attack", label: "W4SQ.OrderAttack" },
  { value: "maneuver", label: "W4SQ.OrderManeuverLong" },
  { value: "idle", label: "W4SQ.OrderIdle" }
];

const IMMEDIATE_ORDER_LABELS = {
  melee: "W4SQ.OrderMelee",
  ranged: "W4SQ.OrderRanged",
  maneuver: "W4SQ.OrderManeuver",
  hold: "W4SQ.OrderHold"
};

function getDisposition(token) {
  return token?.document?.disposition ?? null;
}

function canSee(token) {
  if (game.user.isGM) return true;
  const actor = token?.actor;
  if (!actor) return false;
  const pc = actor.getFlag(FLAG_SCOPE, "playerControlled");
  if (pc === true) return true;
  if (pc === false) return false;
  if (token.isOwner || actor.isOwner) return true;
  return getDisposition(token) === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
}

function getCP(actor) {
  const source = actor?.getFlag(FLAG_SCOPE, "cp") ?? DEFAULT_FLAGS.cp;
  const cp = foundry.utils.duplicate(source ?? {});
  const fallback = DEFAULT_FLAGS.cp ?? { current: 0, cap: 0 };
  return {
    current: Number(cp.current ?? fallback.current ?? 0),
    cap: Number(cp.cap ?? fallback.cap ?? 0)
  };
}

function isSquadToken(token) {
  return Boolean(token?.actor?.getFlag(FLAG_SCOPE, "hp") !== undefined);
}

function collectActiveTokens() {
  const tokens = new Map();
  if (game.combat && game.combat.combatants.size) {
    for (const combatant of game.combat.combatants) {
      const token = combatant?.token?.object || canvas?.tokens?.get(combatant.tokenId);
      if (token && !tokens.has(token.id)) tokens.set(token.id, token);
    }
  }
  if (!tokens.size) {
    for (const token of canvas?.tokens?.placeables ?? []) {
      if (!tokens.has(token.id)) tokens.set(token.id, token);
    }
  }
  return [...tokens.values()].filter(isSquadToken);
}

function resolveContext(target) {
  if (!target) return { token: null, actor: null };
  // Token placeable object
  if (target?.document?.actor) {
    return { token: target, actor: target.actor };
  }
  // Token document
  if (target?.actor && target?.id && target?.object) {
    return { token: target.object, actor: target.actor };
  }
  const actor = target?.actor ?? target;
  if (actor?.getActiveTokens) {
    const [token] = actor.getActiveTokens(true) ?? [];
    if (token) return { token, actor: token.actor };
  }
  return { token: null, actor };
}

function dispositionLabel(disposition) {
  switch (disposition) {
    case CONST.TOKEN_DISPOSITIONS.HOSTILE: return game.i18n.localize("W4SQ.HostileForces");
    case CONST.TOKEN_DISPOSITIONS.FRIENDLY: return game.i18n.localize("W4SQ.FriendlyForces");
    case CONST.TOKEN_DISPOSITIONS.NEUTRAL: return game.i18n.localize("W4SQ.NeutralForces");
    default: return null;
  }
}

export class W4SQCommandApp extends Application {
  static instances = new Map();

  static closeAll() {
    for (const inst of this.instances.values()) {
      inst.close();
    }
    this.instances.clear();
  }

  async close(options) {
    await super.close(options);
    for (const [key, inst] of W4SQCommandApp.instances.entries()) {
      if (inst === this) {
        W4SQCommandApp.instances.delete(key);
      }
    }
  }

  static open(target) {
    const { token, actor } = resolveContext(target);
    const disposition = getDisposition(token) ?? (game.user.isGM ? null : CONST.TOKEN_DISPOSITIONS.FRIENDLY);
    const key = `${game.user.id}:${disposition ?? "all"}`;
    let instance = this.instances.get(key);
    if (!instance) {
      instance = new W4SQCommandApp({ token, actor, disposition });
      this.instances.set(key, instance);
    } else {
      if (token) {
        instance.contextToken = token;
        instance.contextActor = token.actor ?? actor ?? instance.contextActor;
        instance.selectedSquadId = token.id;
      } else if (actor) {
        instance.contextActor = actor;
      }
    }
    instance.render(true);
    return instance;
  }

  constructor({ token, actor, disposition }) {
    super({ template: TEMPLATE, classes: ["w4sq", "command-app"], width: 720 });
    this.contextToken = token || null;
    this.contextActor = actor || token?.actor || null;
    this.selectedSquadId = token?.id ?? null;
    this.disposition = disposition ?? (game.user.isGM ? null : CONST.TOKEN_DISPOSITIONS.FRIENDLY);
  }

  get title() {
    return game.i18n.localize("W4SQ.CommandDashboard");
  }

  _getSquadTokens() {
    let tokens = collectActiveTokens();
    if (this.disposition !== null) {
      tokens = tokens.filter(token => getDisposition(token) === this.disposition);
    }
    return tokens.filter(canSee);
  }

  _getCommander() {
    const squads = this._getSquadTokens();
    const match = squads.find(token => token.actor?.getFlag(FLAG_SCOPE, "isCommander"));
    if (match) return { actor: match.actor, token: match };
    if (this.contextToken?.actor) return { actor: this.contextToken.actor, token: this.contextToken };
    if (this.contextActor) return { actor: this.contextActor, token: this.contextToken ?? null };
    if (squads.length) return { actor: squads[0].actor, token: squads[0] };
    return null;
  }

  _getVisibleSquads() {
    return this._getSquadTokens().map(token => {
      const actor = token.actor;
      const hp = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
      const hpMax = Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 0);
      const morale = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
      const moraleMax = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 0);
      const standingOrder = actor.getFlag(FLAG_SCOPE, "standingOrder") || "";
      const orderKey = actor.getFlag(FLAG_SCOPE, "order") || "";
      return {
        id: token.id,
        name: token.name,
        actorId: actor.id,
        tokenId: token.id,
        hp,
        hpMax,
        hpPct: hpMax > 0 ? Math.round((hp / hpMax) * 100) : 0,
        morale,
        moraleMax,
        moralePct: moraleMax > 0 ? Math.round((morale / moraleMax) * 100) : 0,
        effects: getEffects(actor),
        cooldowns: Object.entries(getCooldowns(actor)),
        lastTargetName: actor.getFlag(FLAG_SCOPE, "lastTargetName") || "",
        order: orderKey,
        orderLabel: orderKey ? game.i18n.localize(IMMEDIATE_ORDER_LABELS[orderKey] || orderKey) : "",
        standingOrder,
        isSelected: this.selectedSquadId === token.id
      };
    });
  }

  async getData() {
    const commanderInfo = this._getCommander();
    const commanderActor = commanderInfo?.actor ?? null;
    const commanderName = commanderInfo?.token?.name ?? commanderActor?.name ?? null;
    const canAdjustCP = Boolean(commanderActor && (game.user.isGM || commanderActor.isOwner));
    const cp = commanderActor ? getCP(commanderActor) : { current: 0, cap: 0 };
    const squads = this._getVisibleSquads();

    if (squads.length) {
      if (!this.selectedSquadId || !squads.some(s => s.id === this.selectedSquadId)) {
        this.selectedSquadId = squads[0].id;
        squads[0].isSelected = true;
      } else {
        for (const squad of squads) {
          squad.isSelected = squad.id === this.selectedSquadId;
        }
      }
    } else {
      this.selectedSquadId = null;
    }

    return {
      commander: commanderName ? { name: commanderName, canAdjustCP } : null,
      cp,
      squads,
      standingOrderOptions: STANDING_ORDER_OPTIONS.map(opt => ({
        value: opt.value,
        label: game.i18n.localize(opt.label)
      })),
      dispositionLabel: dispositionLabel(this.disposition)
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

    html.find('[data-cp-action]').on("click", async ev => {
      const action = ev.currentTarget.dataset.cpAction;
      const commanderInfo = this._getCommander();
      const commander = commanderInfo?.actor ?? null;
      if (!commander) return;
      switch (action) {
        case "delta": {
          const delta = Number(ev.currentTarget.dataset.delta || 0);
          await this._adjustCP(commander, delta);
          break;
        }
        case "set": {
          const value = ev.currentTarget.dataset.value;
          await this._setCP(commander, value);
          break;
        }
      }
      this.render();
    });

    html.find('[data-order-select]').on("change", async ev => {
      const select = ev.currentTarget;
      const tokenId = select.dataset.tokenId;
      const actorId = select.dataset.actorId;
      const value = select.value;
      await this._setStandingOrder({ tokenId, actorId, value });
    });
  }

  _getSelectedActor() {
    const token = this._getSelectedToken();
    return token?.actor ?? null;
  }

  _getSelectedToken() {
    const id = this.selectedSquadId;
    if (!id) return null;
    const squads = this._getSquadTokens();
    return squads.find(token => token.id === id) ?? canvas?.tokens?.get(id) ?? null;
  }

  async _handleCommand(cmd) {
    const commanderInfo = this._getCommander();
    const commander = commanderInfo?.actor ?? null;
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
    if (getCooldown(squad, "cmdRangedPreempt") > 0) {
      ui.notifications.warn(game.i18n.localize("W4SQ.CommandOnCooldown"));
      return;
    }
    if (!(await this._spendCP(commander, 2))) return;
    await doSquadAction(squad, "ranged");
    await setCooldown(squad, "cmdRangedPreempt", 1);
    await this._announceCommand(commander, squad, "W4SQ.ChatCmdRanged");
  }

  async _commandOrders(commander, squad) {
    const options = {
      melee: game.i18n.localize("W4SQ.OrderMelee"),
      ranged: game.i18n.localize("W4SQ.OrderRanged"),
      maneuver: game.i18n.localize("W4SQ.OrderManeuver"),
      hold: game.i18n.localize("W4SQ.OrderHold")
    };
    const content = `<div class="w4sq-orders">${Object.entries(options).map(([key, label]) => `<label><input type="radio" name="order" value="${key}"> ${label}</label>`).join("<br/>")}</div>`;
    const choice = await Dialog.prompt({
      title: game.i18n.localize("W4SQ.NewOrders"),
      content,
      label: game.i18n.localize("W4SQ.Confirm"),
      callback: html => {
        const root = html?.[0] ?? html;
        return root?.querySelector('input[name="order"]:checked')?.value;
      }
    });
    if (!choice) return;
    if (!(await this._spendCP(commander, 1))) return;
    await squad.setFlag(FLAG_SCOPE, "order", choice);
    await squad.setFlag(FLAG_SCOPE, "standingOrder", "");
    await this._announceCommand(commander, squad, "W4SQ.ChatCmdOrders", { order: options[choice] || choice });
  }

  async _commandReorg(commander, squad) {
    if (!(await this._spendCP(commander, 1))) return;
    await clearNegative(squad);
    const roll = await (new Roll("2d20").roll({ async: true }));
    const morale = Number(squad.getFlag(FLAG_SCOPE, "morale") || 0);
    const moraleMax = Number(squad.getFlag(FLAG_SCOPE, "moraleMax") || 0);
    await squad.setFlag(FLAG_SCOPE, "morale", Math.min(moraleMax, morale + roll.total));
    await this._announceCommand(commander, squad, "W4SQ.ChatCmdReorg", { value: roll.total });
  }

  async _commandRally(commander, squad) {
    if (!(await this._spendCP(commander, 1))) return;
    const roll = await (new Roll("1d20").roll({ async: true }));
    const morale = Number(squad.getFlag(FLAG_SCOPE, "morale") || 0);
    const moraleMax = Number(squad.getFlag(FLAG_SCOPE, "moraleMax") || 0);
    await squad.setFlag(FLAG_SCOPE, "morale", Math.min(moraleMax, morale + roll.total));
    await this._announceCommand(commander, squad, "W4SQ.ChatCmdRally", { value: roll.total });
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
    await this._announceCommand(commander, squad, "W4SQ.ChatCmdWithdraw");
  }

  async _commandSpecial(commander, squad) {
    const text = await Dialog.prompt({
      title: game.i18n.localize("W4SQ.SpecialAction"),
      content: `<textarea rows="4" style="width:100%"></textarea>`,
      label: game.i18n.localize("W4SQ.Confirm"),
      callback: html => {
        const root = html?.[0] ?? html;
        return root?.querySelector("textarea")?.value?.trim();
      }
    });
    if (!text) return;
    if (!(await this._spendCP(commander, 1))) return;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: squad }),
      content: `<p><strong>${game.i18n.localize("W4SQ.SpecialAction")}</strong>: ${text}</p>`
    });
    await this._announceCommand(commander, squad, "W4SQ.ChatCmdSpecial");
  }

  async _commandFormation(commander, squad) {
    if (!(await this._spendCP(commander, 2))) return;
    await addEffect(squad, {
      key: "cmd-formation",
      label: "Get in Formation!",
      duration: 1,
      mods: { maneuverTNDice: "+8d10" }
    });
    await this._announceCommand(commander, squad, "W4SQ.ChatCmdFormation");
  }

  async _adjustCP(commander, delta) {
    if (!delta) return;
    const cp = getCP(commander);
    const cap = Number(cp.cap || 0);
    const max = cap > 0 ? cap : Number.POSITIVE_INFINITY;
    cp.current = Math.max(0, Math.min(max, cp.current + delta));
    if (cap > 0) {
      cp.current = Math.min(cp.current, cap);
    }
    cp.current = Math.floor(cp.current);
    await commander.setFlag(FLAG_SCOPE, "cp", cp);
  }

  async _setCP(commander, value) {
    if (!value) return;
    const cp = getCP(commander);
    const cap = Number(cp.cap || 0);
    if (value === "cap") {
      cp.current = cap > 0 ? cap : cp.current;
    } else {
      const parsed = Number(value);
      const max = cap > 0 ? cap : Number.POSITIVE_INFINITY;
      cp.current = Math.max(0, Math.min(max, Number.isNaN(parsed) ? cp.current : parsed));
    }
    cp.current = Math.floor(cp.current);
    await commander.setFlag(FLAG_SCOPE, "cp", cp);
  }

  async _setStandingOrder({ tokenId, actorId, value }) {
    const token = tokenId ? canvas?.tokens?.get(tokenId) : null;
    const actor = token?.actor ?? (actorId ? game.actors?.get(actorId) : null);
    if (!actor) return;
    if (!(game.user.isGM || actor.isOwner)) {
      ui.notifications.warn(game.i18n.localize("W4SQ.NoPermission"));
      return;
    }
    await actor.setFlag(FLAG_SCOPE, "standingOrder", value || "");
    this.render(false);
  }

  async _announceCommand(commander, squad, key, data = {}) {
    const squadName = squad?.name ?? game.i18n.localize("W4SQ.UnknownSquad");
    const commanderName = commander?.name ?? game.i18n.localize("W4SQ.UnknownCommander");
    const template = game.i18n.localize(key);
    const message = template
      .replace("{commander}", commanderName)
      .replace("{squad}", squadName)
      .replace("{order}", data.order ?? "")
      .replace("{value}", data.value ?? "");
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: commander ?? squad }),
      content: `<p>${message}</p>`
    });
  }
}

export function openCommandDashboard(actor) {
  return W4SQCommandApp.open(actor);
}
