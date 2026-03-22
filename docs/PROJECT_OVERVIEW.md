# WFRP4e Squads — Complete Project Overview

This document is a return-to-project reference for the module. It summarizes the playable systems, actor flags, world settings, formulas, automation flow, and exported functions that define the module.

## 1. Module Purpose

`wfrp4e-squads` is a Foundry VTT module for formation-scale combat in WFRP4e. It adds:

- a custom squad actor sheet,
- direct melee/ranged/maneuver resolution,
- a command dashboard with command points and FOB actions,
- origin/passive automation,
- specialist subsystems for mages and engineers,
- Heat of Battle (HoB) random events,
- effect/cooldown ticking,
- and area-template automation for spells, traps, and fortifications.

## 2. Data Model

### 2.1 Actor eligibility

The module treats `character`, `npc`, and `creature` actors as squad-capable, provided they carry the squad HP flag. All squad state is stored in `flags.wfrp4e-squads.*` so the system schema stays untouched.

### 2.2 Default flags

Primary actor flags:

- `hp`, `hpMax`
- `morale`, `moraleMax`
- `experienceTier`, `equipmentTier`
- `role`, `weapon`
- `origin`, `passives`
- `fear`, `terror`, `unbreakable`
- `playerControlled`, `isCommander`, `commanderUserId`
- `effects`, `cooldowns`
- `cp.current`, `cp.cap`
- `order`, `orderManeuver`
- `backlineAttack`
- `specialistType`
- `activeManeuver`
- `hob_hp30`, `hob_mo30`
- `lastTargetName`

Default values are HP 100/100, morale 50/100, role `infantry`, weapon `sword`, CP 3/6, and empty effect/cooldown/order state.

### 2.3 World settings

Registered world settings:

- `enableHoB`: toggles Heat of Battle automation.
- `showUnassignedToPlayers`: controls whether non-GM users see the unassigned dashboard bucket.
- `treasury`: shared FOB treasury used by downtime actions.

## 3. Core formulas

### 3.1 Base attack TN

For melee and ranged actions, the base target number starts as:

`TN = 40 + (experienceTier × 7) + (equipmentTier × 5) + weapon accuracy roll + role accuracy roll + active effect TN roll + hybrid penalty`

Then apply these state modifiers:

- `-10` if morale is below 30%.
- `-20` if HP is 0 or below.
- origin/passive modifiers from `adjustAttackTN`.
- HoB TN adjustments.
- specialist scaling if the actor is a specialist.

### 3.2 Base maneuver TN

For maneuvers, the base target number is:

`TN = 40 + (experienceTier × 7) + (equipmentTier × 5) + difficulty modifier + maneuver-effect roll`

Difficulty modifiers are:

- Easy: `0`
- Average: `-10`
- Hard: `-20`

Then apply the same low-morale and defeated penalties, origin/passive maneuver TN modifiers, HoB adjustments, and specialist scaling.

### 3.3 Specialist TN scaling

Specialists use the same pre-scaled TN, but the final TN is capped and scaled by current HP ratio:

`specialistTN = clamp(min=5, max=125, floor(min(90, TN) × (hp / hpMax)))`

This means specialists become dramatically less reliable as the formation loses HP.

### 3.4 HP scaling helper

Attack logic includes an HP scaling helper:

`hpScale = 0.20 + (1 - 0.20) × (hp / hpMax)`

This documents a 20% floor for HP-based scaling calculations.

### 3.5 Success test

Both action and maneuver resolution use a `1d100` roll:

`success = roll <= finalTN`

### 3.6 Damage / morale flow

A successful attack resolves in this order:

1. compute outgoing damage modifiers,
2. compute defender soak,
3. compute incoming damage modifiers,
4. apply final HP damage,
5. compute morale loss,
6. apply post-hit passive effects,
7. trigger HP/morale threshold logic and HoB.

Failed attacks still inflict chip damage:

`chipDamage = 1d10`

Monster `Multiple Appendages` adds another `1d10` to chip damage in melee.

### 3.7 Morale loss formula

If the defender is not `unbreakable`, morale loss begins as:

`moraleLoss = finalHPDamage + 1d20 + moraleBonus`

Then add fear/terror contributions:

- attacker with Fear: `+1d10`
- attacker with Terror: `+3d10`
- terror-defender resisting fear-only attacker: extra `+1d10`

Then run origin/passive adjustments with `adjustMoraleLoss`.

### 3.8 Reload formula

Base reload cooldown after a ranged action:

- bow: `1`
- crossbow: `1`
- firearm: `2`
- artillery: `3`

`Fast Reload` reduces this by 1, to a minimum of 1. `Continuous Fire` clears reload entirely while active.

### 3.9 Command economy formulas

- Default commander pool: `3 / 6` CP.
- `Ranged! Fire!`: `2` CP.
- `New Orders!`: `1` CP.
- `Rally!`: `1` CP.
- `Withdraw!`: `1` CP.
- `Intercept!`: `1` CP.
- `Special Action`: `1` CP.
- `Get in Formation!`: `2` CP.

### 3.10 FOB formulas

- Rest heals each friendly squad by `1d10` HP, then recomputes morale proportionally:
  - `morale = round((hpAfter × moraleMax) / hpMax)`
- Restore Casualties cost:
  - `cost = ceil(missingHP + missingHP × experienceTier + missingHP × (0.5 × equipmentTier))`
- Upkeep cost per squad:
  - `hpMax + (hpMax × experienceTier)`

## 4. Roles, weapons, and static bonuses

### 4.1 Roles

- `infantry`: melee gets `+1d10` TN and `+1d10` damage.
- `mounted`: same baseline attack bonus as infantry in melee.
- `ranged`: ranged gets `+1d10` TN and `+1d10` damage; melee suffers `-1d20` TN and `-1d20` damage.
- `hybrid`: no built-in role bonus, but melee/ranged actions take a `-1d10` hybrid penalty.
- `specialist`: uses specialist maneuvers and specialist TN scaling.

### 4.2 Weapons

Configured weapon packages:

- `sword`: damage `+1d10`
- `axe`: armor-piercing weapon tag
- `polearm`: no static damage bonus, supports anti-charge maneuvers
- `bow`: standard ranged package
- `crossbow`: standard ranged package
- `firearm`: damage `+1d20`, armor piercing
- `artillery`: damage `+2d20`, armor piercing
- `lance`: mounted weapon package

## 5. Major gameplay systems

### 5.1 Squad sheet

The custom sheet exposes HP, morale, tiers, role, weapon, origin, passive management, cooldowns, active/passive effects, notes, command access, and direct action buttons for Melee, Ranged, Maneuver, and Command.

### 5.2 Command dashboard

The dashboard is the control center for visible squads on the scene. It provides:

- commander detection and CP controls,
- per-user squad buckets,
- selectable squads,
- standing orders and maneuver reminder checkboxes,
- active effect summaries,
- cooldown badges,
- current active maneuver display,
- force-strength bars,
- command buttons,
- and FOB/downtime actions.

Non-GM visibility is filtered by ownership, `playerControlled`, and token disposition.

### 5.3 Orders and maneuver reminder

Each squad stores:

- `order`: `move`, `attack`, `idle`, or blank.
- `orderManeuver`: reminder checkbox state.

`New Orders!` clears the current order and prompts for `melee`, `ranged`, or `hold` announcement text.

### 5.4 Cooldowns

Cooldowns are integer turn counters stored under `flags.wfrp4e-squads.cooldowns`. They are ticked each actor turn and removed at zero. Specialist maneuvers are merged into the dashboard’s cooldown display.

### 5.5 Effects

Effects are lightweight objects stored on the actor flag. Their modifiers can add TN dice, damage dice, soak dice, ranged resistance, maneuver TN, or semantic tags such as:

- `disorganized`
- `tired`
- `flanked`
- `encircled`
- `routed`
- `charged`
- `braced`
- `fortified`
- `disengaged`
- `spentManeuver`
- `skipTurn`
- `halfDamage`
- `noDefense`
- `overwhelmed`

Turns decrement every actor activation. Expiring effects can spawn follow-up effects such as fatigue.

### 5.6 Guard / intercept system

Infantry can guard adjacent allies via maneuver or command. The next melee hit on the protected ally is redirected to the guard unit. The guard then takes additional strain:

- `+1d20` HP
- `+1d20` Morale

Intercept has a 3-tile range limit and also applies a one-turn `Spent Maneuver` effect plus a guard cooldown.

### 5.7 Backline attacks

If `backlineAttack` is enabled and the hit is not redirected by Guard:

- Brace and Phalanx bonuses are ignored.
- Attack gains `+2d10` HP damage.
- Attack gains `+3d10` morale damage.
- If the target falls below 50% morale afterward, it becomes Disorganized.
- Backline attacks do not mark the target as Flanked.

### 5.8 Heat of Battle (HoB)

HoB can trigger from doubles on the d100 test or low HP / low morale thresholds. It can:

- add TN bonuses/penalties,
- add damage bonuses,
- multiply damage,
- add immediate HP/morale changes,
- add/remove effects,
- set an auto-pass flag for the next maneuver,
- and post summarized notes into chat.

The event pools are defined in `scripts/logic/hob-db.js`.

### 5.9 Origins and passives

Supported origins:

- Human
- Dwarf
- Elf
- Monster
- Greenskin
- Ratmen

Origins contribute persistent combat math, while passives add optional modifiers and stateful triggers such as grudge stacks, surge rounds, poisoned targets, or rally-on-zero-morale.

### 5.10 Specialists

Specialists are split into:

- `mage` (cooldown 4)
- `engineer` (cooldown 2)

Specialists use special maneuvers, individual cooldown tracking, and unique failure subsystems:

- Mage: Channel Magic, Minor Perils, Major Perils, echo interactions.
- Engineer: Mishaps, fortifications, minefields, ballistic support, and genius auto-pass.

### 5.11 AoE / zone automation

Template-driven automation exists for:

- `firestorm`
- `fireball`
- `minefield`
- `wolfPits`
- `fortify`
- `lineDefense`

Some zones tick every round, while traps arm after placement and trigger on entry. Occupancy, template deletion, and movement are all handled by hooks.

## 6. Origin and passive math summary

### 6.1 Human

Base origin mitigation:

- incoming HP damage `-5`
- incoming morale loss `-5`

Passives:

- `Battle Drill`: `+10` maneuver TN.
- `Resilient`: another `-5` HP and `-5` morale loss.
- `Adaptive`: `+10` maneuver TN while below 50% HP.
- `Well Equipped`: `+5` armor soak.
- `To the Bitter End!`: first time morale hits 0, restore `4d20` morale, clear Routed and Disorganized, and stand back up at 1 morale if still at 0.

### 6.2 Dwarf

Base origin mitigation:

- magical HP damage × `0.75`
- magical morale bonus × `0.75`

Passives:

- `Iron Will`: morale loss `-20`.
- `Mastercrafted Armor`: `+10` armor soak.
- `Ancestral Grudge`: `+20` damage vs Greenskins or Ratmen.
- `Grudgin'`: gain 1 tick when damaged; each tick gives `+5` TN, up to `+20`.
- `Stalwart`: `+10` armor soak while Braced.

### 6.3 Elf

Base origin offense:

- `+10` damage on attacks.

Passives:

- `Elven Grace`: `+10` TN on attacks and maneuvers.
- `Swift`: after taking HP damage, next maneuver gets `+20` TN.
- `Superior Reflexes`: incoming melee damage `-10`, incoming ranged damage `-5`.
- `Elven Weaponry`: another `+10` damage.
- `Aesthetic Perfection`: if roll `<= floor(TN × 0.1)`, force an HoB critical-success event.

### 6.4 Monster

Base origin modifiers:

- outgoing morale bonus `+10`
- incoming HP damage × `0.8`
- incoming morale bonus × `0.8`

Passives:

- `Bulky`: `+10` damage, `-10` TN.
- `Regeneration`: at round start, heal `1d20 + 10` HP.
- `Thick Hide`: `+3d10 + 5` armor soak on defense.
- `Predator Instinct`: if target morale < 50%, `+30` morale bonus; defender with this passive also takes `+20` incoming damage.
- `Lurker`: in melee, strips `1d20` defense from the target.
- `Multiple Appendages`: `+1` extra attack and extra `1d10` chip damage in melee, but `-20` TN.
- `Horror Incarnate`: `+40` morale bonus and `-20` TN.
- `Colossal`: `+30` damage dealt, but incoming ranged damage `+30`.
- `Devourer`: when striking same-side targets, heal `3d10 + 20` HP.
- `Monstrous Charge`: `+1d20` charge damage, `-10` TN, and `+30` incoming damage.

### 6.5 Greenskin

Base origin offense:

- above 50% HP, `+10` damage.

Passives:

- `Surge`: every 4th round, `+10` TN and `+20` damage.
- `Mob Mentality`: if damage taken in a round is at least 50% of max HP, next round gain `+4d10 + 10` morale pressure; while above 50% HP, incoming morale loss is halved.
- `Gobbos`: `-10` TN and `+20` incoming damage.
- `Big Choppas`: `+10` armor pierce.
- `Unstoppable Wave`: `-20` TN, and charge attacks gain `+40` morale bonus.

### 6.6 Ratmen

Base origin modifiers:

- incoming morale loss `+5`
- flank maneuvers gain `+10` TN

Passives:

- `Coward`: morale loss `+20`; if Flanked, incoming damage `+20`.
- `Poisoner`: successful hit applies `-20` TN for 2 rounds.
- `Musk of Fear`: if allied army HP ratio > 50%, incoming morale × `0.75`; otherwise × `1.5`.
- `Treacherous`: attacking allies applies/uses a 2-round buff for `+20` TN and `+10` damage.
- `Numerous`: adds `+10` morale pressure baseline, gives targets `Overwhelmed`, and takes `+40` damage from AoE/artillery.

## 7. Maneuver catalog

The source of truth is `MANEUVERS` in `scripts/logic/maneuvers.js`. Categories include:

- Universal
- Sword
- Axe
- Polearm
- Bow
- Crossbow
- Firearm
- Artillery
- Hybrid
- Mounted
- Specialist / Mage
- Specialist / Engineer

At a high level:

- Universal maneuvers handle movement posture and battlefield control: Flank, Reorganization, Charge, Brace, Loose Formation, Disengage, Guard.
- Weapon families provide stance-specific accuracy, damage, soak, anti-charge, armor-pierce, or reload effects.
- Mounted maneuvers focus on disruption and breakthroughs.
- Mage maneuvers handle channeling, direct damage, morale shocks, buffs, and magical healing.
- Engineer maneuvers create emplacements, hazards, fortifications, and ranged support buffs.

Failed maneuvers apply `Disorganized (1)` by default through `onManeuverFail`.

## 8. Command catalog

### 8.1 Ranged! Fire!

- Cost: `2` CP
- Effect: selected squad performs a ranged action immediately.
- Cooldown: applies `cmdRangedPreempt = 3` turns.

### 8.2 New Orders!

- Cost: `1` CP
- Effect: clears current order and standing order, resets maneuver reminder, and announces Melee / Ranged / Hold.
- Restriction: commanders cannot receive orders.

### 8.3 Rally!

- Cost: `1` CP
- Effect: restore `4d20` morale, remove Disorganized, clear Routed, and set morale to at least 1 if it would remain at 0.

### 8.4 Withdraw!

- Cost: `1` CP
- Effect: removes Flanked/Encircled states and grants 1 turn of `+1d10` defense soak plus `Disengaged`.

### 8.5 Intercept!

- Cost: `1` CP
- Effect: attach Guard to a same-side ally within 3 tiles, set `guard` cooldown to 1, and apply `Spent Maneuver` for 1 turn.

### 8.6 Special Action

- Cost: `1` CP
- Effect: prompts a freeform text box and posts it to chat.

### 8.7 Get in Formation!

- Cost: `2` CP
- Effect: grants an effect with `+8d10` maneuver TN for 1 turn.

## 9. FOB / downtime catalog

### 9.1 Rest

- Applies `1d10` HP healing to every friendly owned squad.
- Recomputes morale proportionally to new HP.

### 9.2 Restore Casualties

- Fully restores selected friendly squad HP and morale.
- Charges treasury based on missing HP, experience tier, and equipment tier.

### 9.3 Pay Upkeep

- Charges treasury based on each friendly squad’s `hpMax` and `experienceTier`.

### 9.4 Clear Effects

- Removes all tracked effects from the selected squad.

## 10. Hook and automation flow

### 10.1 Init / ready hooks

Initialization registers:

- the actor sheet,
- Handlebars helpers,
- world settings,
- GM socket bridge,
- AoE hooks,
- and the global `game.w4sq.openCommand()` helper.

### 10.2 Combat ticking

At combat start / round / turn changes, the GM processes the active squad actor once per unique round-turn signature. A turn tick does the following:

1. tick effects,
2. tick cooldowns,
3. reduce `activeManeuver.remaining`,
4. enforce morale-based Disorganized below 50%,
5. clear specialist round flags,
6. run origin turn logic.

### 10.3 Ownership bridge

If a non-GM user tries to set or unset squad flags on a document they do not own, the action is proxied to the GM via module socket requests.

## 11. Exported functions by file

This section lists the most important exported APIs and their job.

### 11.1 `scripts/config.js`

- constants for module ID, flag scope, actor types, sheet template, default flags, roll bounds, scaling, roles, weapons, specialist types, and world setting keys.

### 11.2 `scripts/index.js`

- bootstraps the module, registers hooks, runs turn ticks, and exposes `openCommandDashboard`.

### 11.3 `scripts/sheets/squad-sheet.js`

- `SquadActorSheet`: custom actor sheet class that renders squad stats, effects, passives, cooldowns, and controls.

### 11.4 `scripts/features/actions.js`

- `doSquadAction(actor, action)`: resolves melee or ranged attacks end-to-end, including TN building, HoB, soak, damage, morale loss, reload, chat output, and passive hooks.

### 11.5 `scripts/features/maneuver-action.js`

- `openManeuverDialog(actor)`: opens selectable maneuver UI.
- maneuver execution validates prerequisites, computes TN, resolves HoB, triggers auto-pass sources, and applies cooldown/active maneuver state.

### 11.6 `scripts/features/command-dashboard.js`

- `getConnectedUsers()`: returns active users.
- `groupSquadsByUser(squads)`: buckets visible squads by assigned commander user.
- `W4SQCommandApp`: full dashboard application class.
- `openCommandDashboard(actor)`: convenience opener.

### 11.7 `scripts/logic/cooldowns.js`

- read, write, tick, format, describe, and merge cooldown entries for UI display.

### 11.8 `scripts/logic/effects.js`

Key exports:

- `actorHasTag`
- `getEffects`
- `getEffectsDetailed`
- `summarizeEffect`
- `addEffect`
- `ensureEffect`
- `removeEffectByKey`
- `clearNegative`
- `tickEffects`
- `aggregateForAttack`
- `aggregateForDefense`
- `aggregateForManeuvers`
- `ensureDisorganized`
- `removeDisorganized`
- `hasFortified`
- guard helpers: `attachGuard`, `detachGuardByGuard`, `detachGuardByTarget`, `findGuardOnTarget`, `consumeGuardLink`
- `isDisorganized`

These functions are the backbone for status math, stacking, and turn expiry.

### 11.9 `scripts/logic/maneuvers.js`

Key exports:

- `MANEUVERS`: full maneuver definitions.
- `maneuversFor(actor)`: returns maneuvers available to the actor’s role / weapon / specialist type.
- `onManeuverFail(actor, maneuver)`: default failure handling.
- `friendlyTokensNear(actor, distance)`: proximity helper for guard/intercept.

### 11.10 `scripts/logic/hob.js`

- `maybeTriggerHoB(actor, context)`: central HoB trigger and resolution function.

### 11.11 `scripts/logic/hob-db.js`

- `buildHoBDatabase(helpers)`: constructs HoB event pools and immediate handlers.

### 11.12 `scripts/logic/origins.js`

Key exports:

- identity / passive helpers: `getOrigin`, `getPassives`, `getOriginPassivesFor`, `getOriginLabelKey`, `buildDefaultPassives`, `relevantPassives`, `getPassiveLabel`
- combat math: `adjustAttackTN`, `adjustManeuverTN`, `adjustChipDamage`, `adjustDefenseSoak`, `adjustAttackDamage`, `adjustIncomingDamage`, `adjustMoraleLoss`
- passive triggers: `applyPostAttackEffects`, `recordDamageTaken`, `handleMoraleZero`, `handleTurnTick`, `maybeTriggerAestheticHoB`

### 11.13 `scripts/logic/specialists.js`

Key exports:

- specialist identity helpers: `getSpecialistType`, `isSpecialist`, `isMage`, `isEngineer`, `specialistCooldown`
- mage state: `hasChannelledMagic`, `applyChannelledMagic`, `clearChannelledMagic`, `canChannel`, `decrementNoChannel`
- failure subsystems: `triggerMinorPeril`, `triggerMajorPeril`, `triggerEngineerMishap`
- auto-pass / echo helpers: `consumeEngineerGenius`, `consumeSpecialistEcho`, `clearSpecialistRoundFlags`

### 11.14 `scripts/logic/zones.js`

Key exports:

- `randomScenePoint`
- `requestZonePlacement`
- `spawnZone`
- `handleZoneTemplateCreated`
- `handleZoneTokenMove`
- `handleZoneTokenCreated`
- `getZoneHandlers`
- `tickZones`

This is the older zone engine for template placement and environmental effects.

### 11.15 `scripts/aoe.js`

Key exports:

- `registerAoEHooks`
- `createAoEFromEffect`

This is the active AoE hook layer that manages measured templates, template state, token inclusion, and per-round / on-entry processing.

### 11.16 `scripts/passives/chaos.js`

Key exports:

- mutation helpers: `mutationLabel`, `mutationOptions`, `ensureChaosMutation`
- combat hooks: `applyChaosMutationAttack`, `applyChaosMutationDefense`, `handleChaosPostHit`, `applyChaosDamageTaken`, `applyChaosRegeneration`, `applyChaosMutationDamageBonus`, `getChaosMutationFlags`

### 11.17 `scripts/origins/applyOrigin.js`

- `applyOrigin(actor)`: initialization hook for origin-specific startup behavior, currently Chaos mutation assignment.

### 11.18 `scripts/services/chat.js`

- `sendActionMessage(...)`: renders the combat chat card.
- `postNotification(actor, title, body)`: generic chat post helper.

### 11.19 `scripts/services/gm-bridge.js`

- `patchFlagOverrides()`: wraps `setFlag` / `unsetFlag` for GM proxying.
- `registerSocketBridge()`: installs socket request/response handlers.

## 12. Practical “where to look” map

If you are resuming work after a long break, these are the fastest re-entry points:

1. `README.md` for installation and high-level feature intent.
2. `PLAYER_GUIDE.md` for user-facing rules and content list.
3. `scripts/config.js` for defaults and canonical constants.
4. `scripts/features/actions.js` for attack resolution.
5. `scripts/features/maneuver-action.js` plus `scripts/logic/maneuvers.js` for maneuver flow.
6. `scripts/features/command-dashboard.js` for CP, commands, visibility, and FOB logic.
7. `scripts/logic/origins.js` for almost all passive math.
8. `scripts/logic/effects.js` and `scripts/logic/cooldowns.js` for status infrastructure.
9. `scripts/logic/hob.js` and `scripts/logic/hob-db.js` for random-event automation.
10. `scripts/logic/specialists.js` and `scripts/aoe.js` for specialist/AoE work.

## 13. Key implementation notes

- Morale under 50% auto-applies Disorganized through turn ticks and damage handling.
- Morale under 30% gives a flat `-10` TN penalty.
- HP at 0 gives a flat `-20` TN penalty.
- Players can control dashboard visibility with `playerControlled`, ownership, and token disposition.
- Non-owner flag edits are expected to work through the GM socket bridge.
- The module currently contains both `hob-db.js` and `HoB_db.js`; they duplicate the Heat of Battle database builder and should be treated carefully if refactoring.

