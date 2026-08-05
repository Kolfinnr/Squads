import { FLAG_SCOPE, MODULE_ID, DEFAULT_FLAGS, SETTINGS } from "../config.js";
import { getOrigin, undeadBindingState } from "../logic/origins.js";
import { doSquadAction } from "./actions.js";
import {
  addEffect,
  attachGuard,
  getEffects,
  getEffectsDetailed,
  removeDisorganized,
  actorHasTag,
  summarizeEffect
} from "../logic/effects.js";
import { maneuversFor, friendlyTokensNear } from "../logic/maneuvers.js";
import { getCooldown, setCooldown, mergeCooldownEntries } from "../logic/cooldowns.js";

const TEMPLATE = `modules/${MODULE_ID}/templates/command-dashboard.hbs`;

const ORDER_OPTIONS = [
  { value: "", label: "W4SQ.OrderNone" },
  { value: "move", label: "W4SQ.OrderMove" },
  { value: "attack", label: "W4SQ.OrderAttack" },
  { value: "idle", label: "W4SQ.OrderIdle" }
];

const INTERCEPT_TILE_RANGE = 3;

function formatTurns(value) {
  const turns = Math.max(0, Number(value || 0));
  if (turns === 1) return game.i18n.localize("W4SQ.TurnSingle");
  return game.i18n.format("W4SQ.TurnPlural", { value: turns });
}

function interceptRangeDistance() {
  const perTile = canvas?.dimensions?.distance ?? canvas?.grid?.distance ?? 5;
  return perTile * INTERCEPT_TILE_RANGE;
}

export function getConnectedUsers() {
  return (game.users ?? []).filter(user => user.active);
}

export function groupSquadsByUser(squads) {
  const users = getConnectedUsers();
  const buckets = new Map();

  for (const user of users) {
    buckets.set(user.id, { user, squads: [] });
  }

  buckets.set("unassigned", { user: null, squads: [] });

  for (const squad of squads) {
    const ownerId = squad.commanderUserId;
    if (ownerId && buckets.has(ownerId)) {
      buckets.get(ownerId).squads.push(squad);
    } else {
      buckets.get("unassigned").squads.push(squad);
    }
  }

  return { buckets, users };
}

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

function getCommanderAssignment(token) {
  if (!token) return null;
  const tokenFlag = token.document?.getFlag(FLAG_SCOPE, "commanderUserId");
  if (tokenFlag !== undefined) return tokenFlag ?? null;
  const actorFlag = token.actor?.getFlag(FLAG_SCOPE, "commanderUserId");
  if (actorFlag !== undefined) return actorFlag ?? null;
  return null;
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
    if (this._boundActorUpdate) {
      Hooks.off("updateActor", this._boundActorUpdate);
      this._boundActorUpdate = null;
    }
    if (this._boundTokenUpdate) {
      Hooks.off("updateToken", this._boundTokenUpdate);
      this._boundTokenUpdate = null;
    }
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
    super({ template: TEMPLATE, classes: ["w4sq", "command-app"], width: 860 });
    this.contextToken = token || null;
    this.contextActor = actor || token?.actor || null;
    this.selectedSquadId = token?.id ?? null;
    this.disposition = disposition ?? (game.user.isGM ? null : CONST.TOKEN_DISPOSITIONS.FRIENDLY);
    this._maneuverState = new Map();
    this._boundActorUpdate = this._onActorUpdate.bind(this);
    this._boundTokenUpdate = this._onTokenUpdate.bind(this);
    Hooks.on("updateActor", this._boundActorUpdate);
    Hooks.on("updateToken", this._boundTokenUpdate);
  }

  get title() {
    return game.i18n.localize("W4SQ.CommandDashboard");
  }

  _onActorUpdate(actor) {
    if (!this.rendered) return;
    if (!actor || actor.getFlag(FLAG_SCOPE, "hp") === undefined) return;
    const commander = this._getCommander()?.actor;
    const relevant = commander?.id === actor.id || this._getSquadTokens().some(token => token.actor?.id === actor.id);
    if (relevant) {
      this.render(false);
    }
  }

  _onTokenUpdate(tokenDoc) {
    if (!this.rendered) return;
    if (!tokenDoc) return;
    const actor = tokenDoc.actor ?? null;
    if (!actor || actor.getFlag(FLAG_SCOPE, "hp") === undefined) return;
    const visible = this._getSquadTokens().some(token => token.id === tokenDoc.id);
    if (visible) {
      this.render(false);
    }
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
      const role = actor.getFlag(FLAG_SCOPE, "role") || "infantry";
      const hp = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
      const hpMax = Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 0);
      const morale = Number(actor.getFlag(FLAG_SCOPE, "morale") || 0);
      const moraleMax = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 0);
      const activeManeuver = actor.getFlag(FLAG_SCOPE, "activeManeuver") || null;
      const activeInfo = activeManeuver
        ? {
            name: activeManeuver.name || null,
            remaining: Math.max(0, Number(activeManeuver.remaining ?? 0)),
            remainingLabel: formatTurns(Math.max(0, Number(activeManeuver.remaining ?? 0)))
          }
        : null;
      const effects = getEffectsDetailed(actor).map(effect => ({
        ...effect,
        durationLabel: formatTurns(effect.duration ?? 0),
        summary: summarizeEffect(effect)
      }));
      const specialistExtras = [];
      if (role === "specialist") {
        for (const maneuver of maneuversFor(actor)) {
          if (maneuver.category !== "specialist") continue;
          const remaining = getCooldown(actor, maneuver.key);
          if (remaining > 0) {
            specialistExtras.push({ key: maneuver.key, label: maneuver.name, rounds: remaining });
          }
        }
      }
      const cooldowns = mergeCooldownEntries(actor, specialistExtras);
      let order = actor.getFlag(FLAG_SCOPE, "order");
      if (order === undefined || order === null) {
        order = actor.getFlag(FLAG_SCOPE, "standingOrder") || "";
      }
      order = order || "";
      const isCommander = Boolean(actor.getFlag(FLAG_SCOPE, "isCommander"));
      let maneuverChecked;
      if (this._maneuverState.has(token.id)) {
        maneuverChecked = this._maneuverState.get(token.id);
      } else {
        const flagged = Boolean(actor.getFlag(FLAG_SCOPE, "orderManeuver"));
        maneuverChecked = flagged;
        this._maneuverState.set(token.id, maneuverChecked);
      }
      const binding = getOrigin(actor) === "undead" ? undeadBindingState(actor) : null;
      return {
        id: token.id,
        name: token.name,
        actorId: actor.id,
        tokenId: token.id,
        commanderUserId: getCommanderAssignment(token),
        hp,
        hpMax,
        hpPct: hpMax > 0 ? Math.round((hp / hpMax) * 100) : 0,
        morale,
        moraleMax,
        moralePct: moraleMax > 0 ? Math.round((morale / moraleMax) * 100) : 0,
        effects,
        cooldowns,
        activeManeuver: activeInfo,
        binding: binding ? {
          label: game.i18n.localize(binding.bindingLabelKey),
          crumbling: binding.crumbling,
          crumblingLabel: binding.crumbling ? game.i18n.localize("W4SQ.EffectUndeadCrumbling") : ""
        } : null,
        lastTargetName: actor.getFlag(FLAG_SCOPE, "lastTargetName") || "",
        order,
        maneuverChecked,
        isCommander,
        canReceiveOrders: !isCommander,
        isSelected: this.selectedSquadId === token.id
      };
    });
  }

  _getStrengthTotals() {
    const tokens = collectActiveTokens().filter(canSee);
    const totals = {
      allied: { current: 0, max: 0 },
      hostile: { current: 0, max: 0 }
    };

    for (const token of tokens) {
      const actor = token.actor;
      if (!actor) continue;
      const disposition = getDisposition(token);
      const bucket =
        disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY
          ? totals.allied
          : disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE
          ? totals.hostile
          : null;
      if (!bucket) continue;
      bucket.current += Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
      bucket.max += Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 0);
    }

    const totalCurrent = totals.allied.current + totals.hostile.current;
    const alliedPct = totalCurrent > 0 ? Math.round((totals.allied.current / totalCurrent) * 100) : 50;

    return {
      ...totals,
      totalCurrent,
      alliedPct,
      hostilePct: 100 - alliedPct
    };
  }

  _getTreasury() {
    const value = game.settings.get(MODULE_ID, SETTINGS.treasury);
    return Number.isFinite(value) ? Number(value) : 0;
  }

  async _setTreasury(value) {
    const safe = Math.max(0, Math.round(Number(value) || 0));
    await game.settings.set(MODULE_ID, SETTINGS.treasury, safe);
    return safe;
  }

  _getFriendlySquads() {
    return this._getSquadTokens().filter(token => getDisposition(token) === CONST.TOKEN_DISPOSITIONS.FRIENDLY);
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

    const { buckets: bucketMap, users } = groupSquadsByUser(squads);
    const useBuckets = users.length > 0;
    const isGM = game.user.isGM;
    const showUnassignedToPlayers = game.settings.get(MODULE_ID, SETTINGS.showUnassignedToPlayers);

    const bucketList = [];
    if (useBuckets) {
      for (const [bucketId, entry] of bucketMap.entries()) {
        if (!isGM) {
          const isCurrentUserBucket = bucketId === game.user.id;
          const isUnassignedBucket = bucketId === "unassigned";
          if (!isCurrentUserBucket && !(isUnassignedBucket && showUnassignedToPlayers)) continue;
        }

        const label = entry.user
          ? game.i18n.format("W4SQ.BucketPlayer", { name: entry.user.name })
          : game.i18n.localize("W4SQ.BucketUnassigned");

        bucketList.push({
          id: bucketId,
          label,
          user: entry.user ? { id: entry.user.id, name: entry.user.name } : null,
          squads: entry.squads
        });
      }
    }

    const ownerOptions = [
      { value: "", label: game.i18n.localize("W4SQ.OwnerUnassigned") },
      ...users.map(user => ({ value: user.id, label: user.name }))
    ];

    return {
      commander: commanderName ? { name: commanderName, canAdjustCP } : null,
      cp,
      squads,
       buckets: bucketList,
       useBuckets,
       showOwnerControls: isGM,
       ownerOptions,
      orderOptions: ORDER_OPTIONS.map(opt => ({
        value: opt.value,
        label: game.i18n.localize(opt.label)
      })),
      dispositionLabel: dispositionLabel(this.disposition),
      strength: this._getStrengthTotals(),
      treasury: this._getTreasury()
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find('.effect-chip[data-summary]').on("click", ev => {
      const chip = ev.currentTarget;
      const { summary } = chip.dataset;
      if (!summary) return;
      const container = chip.closest(".effect-list");
      if (!container) return;

      const existing = container.querySelector(".effect-summary-popup");
      if (existing?.dataset?.source === summary) {
        existing.remove();
        return;
      }
      existing?.remove();

      const label = chip.dataset.label || game.i18n.localize("W4SQ.ActiveEffects");
      const closeLabel = game.i18n.localize("Close");
      const popup = document.createElement("div");
      popup.classList.add("effect-summary-popup");
      popup.dataset.source = summary;

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.classList.add("close");
      closeBtn.setAttribute("aria-label", closeLabel);
      closeBtn.textContent = "\u00d7";

      const labelEl = document.createElement("p");
      labelEl.classList.add("label");
      labelEl.textContent = label;

      const summaryEl = document.createElement("p");
      summaryEl.classList.add("summary");
      summaryEl.textContent = summary;

      closeBtn.addEventListener("click", () => popup.remove());

      popup.append(closeBtn, labelEl, summaryEl);
      container.appendChild(popup);
    });

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
      await this._setOrder({ tokenId, actorId, value });
    });

    html.find('[data-order-maneuver]').on("change", ev => {
      const input = ev.currentTarget;
      const tokenId = input.dataset.tokenId;
      const checked = Boolean(input.checked);
      if (!tokenId) return;
      this._maneuverState.set(tokenId, checked);
    });

    if (game.user.isGM) {
      html.find(".w4sq-owner-select").on("change", async ev => {
        const select = ev.currentTarget;
        const tokenId = select.dataset.tokenId;
        const actorId = select.dataset.actorId;
        const userId = select.value || null;
        const token = canvas?.tokens?.get(tokenId) ?? null;
        if (token?.document) {
          await token.document.setFlag(FLAG_SCOPE, "commanderUserId", userId);
          this.render();
          return;
        }
        const actor = game.actors.get(actorId);
        if (!actor) return;
        await actor.setFlag(FLAG_SCOPE, "commanderUserId", userId);
        this.render();
      });
    }

    html.find('[data-treasury-input]').on("change", async ev => {
      await this._setTreasury(ev.currentTarget.value);
      this.render(false);
    });

    html.find('[data-fob-action]').on("click", async ev => {
      const action = ev.currentTarget.dataset.fobAction;
      await this._handleFobAction(action);
      this.render();
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
      case "cmd-rally":
        await this._commandRally(commander, squad);
        break;
      case "cmd-withdraw":
        await this._commandWithdraw(commander, squad);
        break;
      case "cmd-intercept":
        await this._commandIntercept(commander, squad);
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
    await setCooldown(squad, "cmdRangedPreempt", 3);
    await this._announceCommand(commander, squad, "W4SQ.ChatCmdRanged");
  }

  async _commandOrders(commander, squad) {
    if (squad.getFlag(FLAG_SCOPE, "isCommander")) {
      ui.notifications.warn(game.i18n.localize("W4SQ.CommanderOrdersBlocked"));
      return;
    }
    const options = {
      melee: game.i18n.localize("W4SQ.OrderMelee"),
      ranged: game.i18n.localize("W4SQ.OrderRanged"),
      hold: game.i18n.localize("W4SQ.OrderHold")
    };
    const content = `<div class="w4sq-orders">${Object.entries(options).map(([key, label]) => `<label><input type="radio" name="order" value="${key}"> ${label}</label>`).join("<br/>")}</div>`;
    const choice = await Dialog.prompt({
      title: game.i18n.localize("W4SQ.NewOrders"),
      content,
      label: game.i18n.localize("W4SQ.Confirm"),
      callback: html => {
        if (!html) return null;
        if (html.jquery) {
          const value = html.find('input[name="order"]:checked').val();
          return value?.length ? value : null;
        }
        const root = html?.[0] ?? html;
        if (root?.querySelector) {
          return root.querySelector?.('input[name="order"]:checked')?.value ?? null;
        }
        return null;
      }
    });
    if (!choice) return;
    if (!(await this._spendCP(commander, 1))) return;
    await squad.setFlag(FLAG_SCOPE, "order", "");
    await squad.unsetFlag(FLAG_SCOPE, "standingOrder");
    const token = this._getSelectedToken();
    if (token) this._maneuverState.set(token.id, false);
    await this._announceCommand(commander, squad, "W4SQ.ChatCmdOrders", { order: options[choice] || choice });
  }

  async _commandRally(commander, squad) {
    if (!(await this._spendCP(commander, 1))) return;
    const roll = await (new Roll("4d20").evaluate({}));
    const morale = Number(squad.getFlag(FLAG_SCOPE, "morale") || 0);
    const moraleMax = Number(squad.getFlag(FLAG_SCOPE, "moraleMax") || 0);
    const restored = Math.min(moraleMax, morale + roll.total);
    await squad.setFlag(FLAG_SCOPE, "morale", restored);
    await removeDisorganized(squad);
    const effects = getEffects(squad).filter(effect => !effect?.mods?.tags?.routed);
    await squad.setFlag(FLAG_SCOPE, "effects", effects);
    if (restored <= 0 && moraleMax > 0) {
      await squad.setFlag(FLAG_SCOPE, "morale", Math.min(moraleMax, 1));
    }
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

  _getInterceptTargetActor(squad) {
    const targets = [...game.user.targets];
    if (targets.length !== 1) {
      ui.notifications.warn(game.i18n.localize("W4SQ.InterceptSelect"));
      return null;
    }
    const token = targets[0];
    const actor = token?.actor;
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("W4SQ.InterceptSelect"));
      return null;
    }
    if (actor === squad) {
      ui.notifications.warn(game.i18n.localize("W4SQ.InterceptSelf"));
      return null;
    }
    const squadTokens = squad.getActiveTokens?.(true) ?? [];
    const origin = squadTokens[0];
    if (!origin) {
      ui.notifications.warn(game.i18n.localize("W4SQ.InterceptNoToken"));
      return null;
    }
    if (token.document?.disposition !== origin.document?.disposition) {
      ui.notifications.warn(game.i18n.localize("W4SQ.WarnSelectAlly"));
      return null;
    }
    const distance = interceptRangeDistance();
    const nearby = friendlyTokensNear(squad, distance);
    const withinRange = nearby.some(t => t.id === token.id);
    if (!withinRange) {
      ui.notifications.warn(game.i18n.localize("W4SQ.InterceptRange"));
      return null;
    }
    return { actor, token };
  }

  async _commandIntercept(commander, squad) {
    const role = squad.getFlag(FLAG_SCOPE, "role") || "infantry";
    if (role !== "infantry") {
      ui.notifications.warn(game.i18n.localize("W4SQ.InterceptRole"));
      return;
    }
    const forbidden = ["disorganized", "engaged", "prone"];
    if (forbidden.some(tag => actorHasTag(squad, tag))) {
      ui.notifications.warn(game.i18n.localize("W4SQ.InterceptStatus"));
      return;
    }
    if (getCooldown(squad, "guard") > 0) {
      ui.notifications.warn(game.i18n.localize("W4SQ.InterceptCooldown"));
      return;
    }
    const targetInfo = this._getInterceptTargetActor(squad);
    if (!targetInfo) return;
    if (!(await this._spendCP(commander, 1))) return;
    await attachGuard(squad, targetInfo.actor, { source: "intercept" });
    await setCooldown(squad, "guard", 1);
    await addEffect(squad, {
      key: crypto.randomUUID?.() ?? randomID(),
      label: game.i18n.localize("W4SQ.EffectSpentManeuver"),
      duration: 1,
      mods: { tags: { spentManeuver: true } }
    });
    await this._announceCommand(commander, squad, "W4SQ.ChatCmdIntercept", { ally: targetInfo.actor.name || "" });
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

  async _handleFobAction(action) {
    switch (action) {
      case "rest":
        await this._fobRest();
        break;
      case "restore":
        await this._fobRestoreCasualties();
        break;
      case "upkeep":
        await this._fobPayUpkeep();
        break;
      case "clear-effects":
        await this._fobClearEffects();
        break;
    }
  }

  async _fobRest() {
    const squads = this._getFriendlySquads().filter(token => game.user.isGM || token.actor?.isOwner);
    if (!squads.length) {
      ui.notifications.warn(game.i18n.localize("W4SQ.FobNoSquads"));
      return;
    }
    for (const token of squads) {
      const actor = token.actor;
      const hpMax = Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 0);
      const moraleMax = Number(actor.getFlag(FLAG_SCOPE, "moraleMax") || 0);
      if (hpMax <= 0) continue;
      const hp = Number(actor.getFlag(FLAG_SCOPE, "hp") || 0);
      const roll = await new Roll("1d10").evaluate({});
      const healedHp = Math.min(hpMax, hp + roll.total);
      await actor.setFlag(FLAG_SCOPE, "hp", healedHp);
      if (moraleMax > 0) {
        const morale = Math.round((healedHp * moraleMax) / Math.max(1, hpMax));
        await actor.setFlag(FLAG_SCOPE, "morale", morale);
      }
    }
    ui.notifications.info(game.i18n.localize("W4SQ.FobRestApplied"));
  }

  async _fobRestoreCasualties() {
    const token = this._getSelectedToken();
    const squad = token?.actor ?? null;
    if (!squad) {
      ui.notifications.warn(game.i18n.localize("W4SQ.SelectSquad"));
      return;
    }
    if (getDisposition(token) !== CONST.TOKEN_DISPOSITIONS.FRIENDLY) {
      ui.notifications.warn(game.i18n.localize("W4SQ.NoPermission"));
      return;
    }
    if (!(game.user.isGM || squad.isOwner)) {
      ui.notifications.warn(game.i18n.localize("W4SQ.NoPermission"));
      return;
    }
    const hpMax = Number(squad.getFlag(FLAG_SCOPE, "hpMax") || 0);
    const hp = Number(squad.getFlag(FLAG_SCOPE, "hp") || 0);
    const missing = Math.max(0, hpMax - hp);
    if (missing <= 0) {
      ui.notifications.info(game.i18n.localize("W4SQ.FobNoCasualties"));
      return;
    }
    const exp = Number(squad.getFlag(FLAG_SCOPE, "experienceTier") || 0);
    const eq = Number(squad.getFlag(FLAG_SCOPE, "equipmentTier") || 0);
    const cost = Math.ceil(missing + missing * exp + missing * (0.5 * eq));
    const treasury = this._getTreasury();
    if (cost > treasury) {
      ui.notifications.warn(game.i18n.localize("W4SQ.FobNotEnoughFunds"));
      return;
    }
    await this._setTreasury(treasury - cost);
    await squad.setFlag(FLAG_SCOPE, "hp", hpMax);
    const moraleMax = Number(squad.getFlag(FLAG_SCOPE, "moraleMax") || 0);
    if (moraleMax > 0) {
      await squad.setFlag(FLAG_SCOPE, "morale", moraleMax);
    }
    ui.notifications.info(game.i18n.format("W4SQ.FobRestored", { cost }));
  }

  async _fobPayUpkeep() {
    const squads = this._getFriendlySquads().filter(token => game.user.isGM || token.actor?.isOwner);
    if (!squads.length) {
      ui.notifications.warn(game.i18n.localize("W4SQ.FobNoSquads"));
      return;
    }
    const totalCost = squads.reduce((sum, token) => {
      const actor = token.actor;
      const hpMax = Number(actor.getFlag(FLAG_SCOPE, "hpMax") || 0);
      const exp = Number(actor.getFlag(FLAG_SCOPE, "experienceTier") || 0);
      return sum + Math.max(0, hpMax + hpMax * exp);
    }, 0);
    const treasury = this._getTreasury();
    if (totalCost > treasury) {
      ui.notifications.warn(game.i18n.localize("W4SQ.FobNotEnoughFunds"));
      return;
    }
    await this._setTreasury(treasury - totalCost);
    ui.notifications.info(game.i18n.format("W4SQ.FobUpkeepPaid", { cost: totalCost }));
  }

  async _fobClearEffects() {
    const token = this._getSelectedToken();
    const squad = token?.actor ?? null;
    if (!squad) {
      ui.notifications.warn(game.i18n.localize("W4SQ.SelectSquad"));
      return;
    }
    if (!(game.user.isGM || squad.isOwner)) {
      ui.notifications.warn(game.i18n.localize("W4SQ.NoPermission"));
      return;
    }
    await squad.setFlag(FLAG_SCOPE, "effects", []);
    ui.notifications.info(game.i18n.localize("W4SQ.FobClearedEffects"));
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

  async _setOrder({ tokenId, actorId, value }) {
    const token = tokenId ? canvas?.tokens?.get(tokenId) : null;
    const actor = token?.actor ?? (actorId ? game.actors?.get(actorId) : null);
    if (!actor) return;
    if (actor.getFlag(FLAG_SCOPE, "isCommander")) return;
    if (!(game.user.isGM || actor.isOwner)) {
      ui.notifications.warn(game.i18n.localize("W4SQ.NoPermission"));
      return;
    }
    await actor.setFlag(FLAG_SCOPE, "order", value || "");
    await actor.unsetFlag(FLAG_SCOPE, "standingOrder");
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
      .replace("{value}", data.value ?? "")
      .replace("{ally}", data.ally ?? "");
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: commander ?? squad }),
      content: `<p>${message}</p>`
    });
  }
}

export function openCommandDashboard(actor) {
  return W4SQCommandApp.open(actor);
}
