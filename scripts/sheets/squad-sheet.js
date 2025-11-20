import { FLAG_SCOPE, SHEET_TEMPLATE, WEAPONS, ROLES, DEFAULT_FLAGS, SPECIALIST_TYPES } from "../config.js";
import { doSquadAction } from "../features/actions.js";
import { openManeuverDialog } from "../features/maneuver-action.js";
import { getEffectsDetailed } from "../logic/effects.js";
import { getCooldown, mergeCooldownEntries } from "../logic/cooldowns.js";
import { maneuversFor } from "../logic/maneuvers.js";
import { openCommandDashboard } from "../features/command-dashboard.js";
import { ORIGIN_KEYS, getOriginLabelKey, getPassiveLabel, getOriginPassivesFor, hasUndeadMaster } from "../logic/origins.js";
import { getChaosMutationFlags, mutationLabel, mutationOptions } from "../passives/chaos.js";

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
    const originFlag = f("origin", null);
    const origin = typeof originFlag === "string" ? originFlag : (squadSystem.origin ?? "");
    const passiveState = foundry.utils.duplicate(f("passives", squadSystem.passives ?? {})) || {};
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
    const chaosMutation = origin === "chaos" ? getChaosMutationFlags(this.actor) : null;
    const mutationLabelKey = chaosMutation?.mutation ? mutationLabel(chaosMutation.mutation) : "W4SQ.MutationUnset";
    const chaosMutationChip = origin === "chaos"
      ? (() => {
          const detailLines = chaosMutation?.mutation
            ? [
                chaosMutation.gazeStacks
                  ? game.i18n.format("W4SQ.MutationGazeStacks", { stacks: chaosMutation.gazeStacks })
                  : null,
                chaosMutation.ritualStacks
                  ? game.i18n.format("W4SQ.MutationRitualStacks", { stacks: chaosMutation.ritualStacks })
                  : null
              ].filter(Boolean)
            : [];
          const tooltip = chaosMutation?.mutation
            ? [game.i18n.localize(mutationLabelKey), ...detailLines].join(" • ")
            : game.i18n.localize("W4SQ.MutationShieldEmpty");
          return {
            key: chaosMutation?.mutation || "chaos-mutation",
            label: game.i18n.localize(mutationLabelKey),
            type: "mutation",
            shield: true,
            shieldTooltip: tooltip,
            details: null
          };
        })()
      : null;
    const selectedOriginPassives = originPassiveKeys
      .filter(key => Boolean(passiveState?.[key]))
      .map(key => ({
        key,
        label: game.i18n.localize(getPassiveLabel(key))
      }));
    data.originPassives = originPassiveKeys.map(key => ({
      key,
      label: game.i18n.localize(getPassiveLabel(key)),
      checked: Boolean(passiveState?.[key])
    }));
    data.originPassiveSummary = selectedOriginPassives;
    data.passiveChips = [
      ...(chaosMutationChip ? [chaosMutationChip] : []),
      ...selectedOriginPassives.map(passive => ({
        key: passive.key,
        label: passive.label,
        type: "origin"
      })),
      ...passiveEffects.map(effect => ({
        key: effect.key ?? effect.label,
        label: effect.label,
        type: "effect",
        polarity: effect.polarity,
        durationLabel: effect.durationLabel
      }))
    ];
    const puppetStatus = origin === "undead" && passiveState?.undeadPuppet
      ? { hasMaster: hasUndeadMaster(this.actor) }
      : null;
    if (puppetStatus) {
      activeEffects.push({
        key: "undead-master-presence",
        label: game.i18n.localize(puppetStatus.hasMaster ? "W4SQ.ActiveUndeadMastersPresent" : "W4SQ.ActiveUndeadMastersMissing"),
        durationLabel: game.i18n.localize("W4SQ.PassiveEffectDuration")
      });
    }
    data.puppetStatus = puppetStatus;
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
    html.find('button[data-action="manage-passives"]').on("click", ev => {
      ev.preventDefault();
      this._openPassivesDialog();
    });
    html.find(".effect-chip.passive.mutation").on("click", ev => {
      ev.preventDefault();
      this._toggleMutationMenu(ev.currentTarget);
    });
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

  _getOriginSelection() {
    const originFlag = this.actor.getFlag(FLAG_SCOPE, "origin");
    if (typeof originFlag === "string" && originFlag.length) return originFlag;
    const squadSystem = foundry.utils.getProperty(this.actor.system ?? this.actor.data?.data, "squad") || {};
    return squadSystem.origin ?? null;
  }

  _openPassivesDialog() {
    const origin = this._getOriginSelection();
    if (!origin) {
      ui.notifications?.info(game.i18n.localize("W4SQ.ManagePassivesNoOrigin"));
      return;
    }

    const passiveKeys = getOriginPassivesFor(origin) || [];
    if (!passiveKeys.length) {
      ui.notifications?.info(game.i18n.localize("W4SQ.ManagePassivesUnavailable"));
      return;
    }

    const originLabel = game.i18n.localize(getOriginLabelKey(origin));
    const passiveState = foundry.utils.duplicate(this.actor.getFlag(FLAG_SCOPE, "passives") || {});
    const rows = passiveKeys.map(key => {
      const label = game.i18n.localize(getPassiveLabel(key));
      const checked = passiveState?.[key] ? "checked" : "";
      return `<label class="passive-entry"><input type="checkbox" data-passive-key="${key}" ${checked}/> ${label}</label>`;
    }).join("");

    const content = `
      <form class="w4sq-passive-dialog">
        <p class="hint">${game.i18n.format("W4SQ.ManagePassivesHint", { origin: originLabel })}</p>
        <div class="passive-list">
          ${rows}
        </div>
      </form>
    `;

    const dialog = new Dialog({
      title: game.i18n.localize("W4SQ.ManagePassivesTitle"),
      content,
      buttons: {
        close: {
          icon: "",
          label: game.i18n.localize("Close")
        }
      },
      render: html => {
        html.find("input[data-passive-key]").on("change", async ev => {
          const input = ev.currentTarget;
          const key = input.dataset.passiveKey;
          const checked = input.checked;
          try {
            await this.actor.update({ [`flags.${FLAG_SCOPE}.passives.${key}`]: checked });
          } catch (err) {
            console.error(`wfrp4e-squads | Failed to update passive ${key}`, err);
          }
        });
      }
    });

    dialog.render(true);
  }

  async close(options) {
    this._closeMutationMenu();
    return super.close(options);
  }

  _toggleMutationMenu(anchor) {
    const node = anchor instanceof HTMLElement ? anchor : anchor?.currentTarget;
    if (!node) return;
    if (this._activeMutationMenu?.anchor === node) {
      this._closeMutationMenu();
      return;
    }
    this._openMutationMenu(node);
  }

  _closeMutationMenu() {
    if (this._activeMutationMenu?.menu) {
      this._activeMutationMenu.menu.remove();
    }
    if (this._activeMutationMenu?.handler) {
      document.removeEventListener("click", this._activeMutationMenu.handler, true);
    }
    this._activeMutationMenu = null;
  }

  async _selectMutation(key) {
    const update = key ? { mutation: key } : { mutation: null };
    try {
      if (update.mutation) {
        await this.actor.setFlag(FLAG_SCOPE, "chaosMutation", update.mutation);
      } else {
        await this.actor.unsetFlag(FLAG_SCOPE, "chaosMutation");
      }
      await this.actor.unsetFlag(FLAG_SCOPE, "chaosGazeStacks");
      await this.actor.unsetFlag(FLAG_SCOPE, "chaosRitualStacks");
      await this.actor.unsetFlag(FLAG_SCOPE, "chaosWarpedBonus");
      await this.actor.unsetFlag(FLAG_SCOPE, "chaosShapeTargets");
      this.render(false);
    } catch (err) {
      console.error("wfrp4e-squads | Failed to set mutation", err);
    } finally {
      this._closeMutationMenu();
    }
  }

  _openMutationMenu(anchor) {
    const container = document.createElement("div");
    container.classList.add("w4sq-mutation-menu");

    const hint = document.createElement("p");
    hint.classList.add("hint");
    hint.textContent = game.i18n.localize("W4SQ.MutationMenuHint");
    container.appendChild(hint);

    const list = document.createElement("div");
    list.classList.add("mutation-menu-list");

    const current = this.actor.getFlag(FLAG_SCOPE, "chaosMutation") || "";
    const createRow = (value, label) => {
      const row = document.createElement("label");
      row.classList.add("mutation-menu-entry");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "chaos-mutation";
      input.value = value;
      input.checked = value === current;
      input.addEventListener("change", () => this._selectMutation(value));
      const text = document.createElement("span");
      text.textContent = game.i18n.localize(label);
      row.append(input, text);
      list.appendChild(row);
    };

    createRow("", "W4SQ.MutationUnset");
    for (const opt of mutationOptions()) {
      createRow(opt.key, opt.label);
    }

    container.appendChild(list);

    document.body.appendChild(container);
    const rect = anchor.getBoundingClientRect();
    container.style.left = `${rect.left + window.scrollX}px`;
    container.style.top = `${rect.bottom + window.scrollY + 4}px`;

    const closeHandler = ev => {
      if (!container.contains(ev.target) && ev.target !== anchor) {
        this._closeMutationMenu();
      }
    };

    document.addEventListener("click", closeHandler, true);
    this._activeMutationMenu = { menu: container, handler: closeHandler, anchor };
  }
}
