# WFRP4e – Squads (Foundry v13)

**WFRP4e – Squads** adds a compact squad sheet, command dashboard, and Heat of Battle automation for Warhammer Fantasy Roleplay 4e tables that want to run formation-scale clashes without leaving Foundry VTT.

## Installation
1. Copy or clone this repository into `Data/modules/wfrp4e-squads/` inside your Foundry user data folder.
2. Start Foundry VTT and enable **WFRP4e – Squads** from *Configuration → Manage Modules*.
3. Reload the world so Foundry picks up the module files.

## Quick Start (Players & GMs)
1. Create a new **Actor → Type: Squad** for each unit that will take the field.
2. On the **Main** tab fill in HP, Morale, Experience tier, Equipment tier, Role, and Weapon. Traits such as Fear or Unbreakable can be toggled directly on the header.
3. Use the **Maneuver**, **Melee**, or **Ranged** buttons on the sheet to resolve actions. Results, soak, and morale loss are posted to chat automatically.
4. Toggle **Backline Attack** on the squad sheet when a unit is striking from the rear to ignore Brace/Phalanx bonuses and apply the special damage and morale pressure.
5. Open the **Command** button to launch the command dashboard. From here commanders spend CP on Ranged! Fire!, New Orders!, Rally!, Withdraw!, and other directive buttons. CP defaults to 3/6 and can be adjusted in the dashboard.
6. Heat of Battle triggers (doubles on tests or low HP/Morale) resolve in the background. Chat cards summarise what effect was applied along with any immediate TN or damage adjustments.

## Command Dashboard Highlights
- **Orders column** tracks each squad’s standing order. Hitting *New Orders!* clears the selection so commanders can set a fresh stance.
- A **Maneuver** reminder checkbox sits to the left of the Orders drop-down for groups that want to note their intended maneuvers without touching squad data.
- The new **Maneuver Tracker** panel summarizes the selected squad’s active maneuver, remaining turns, and cooldowns while counting how many CP the commander has spent.
- Cooldown badges list command locks and reloading timers (bows/crossbows 1 round, firearms 2 rounds, artillery 3 rounds) so you always know which units are ready to act.
- Only on-scene squads that match the viewer’s disposition are listed, keeping the roster focused on relevant units.

## Heat of Battle Tables
- Four Heat of Battle pools (critical successes, critical failures, low HP, and low morale) are included directly in the module with **ten** events apiece.
- Events apply immediately during the triggering roll—boosts and penalties are rolled on the spot and summarised in chat.
- To customise the pool contents, edit `scripts/logic/hob-db.js` where all four tables are defined.

## Tips for Table Play
- **Chip damage matters:** even a failed attack deals 1d10 damage to keep pressure on defenders.
- **Morale is lethal:** Fear, Terror, and critical events can shred morale quickly. Keep Rally! or Reorganization ready.
- **Track fatigue:** the tired condition now penalises bow and crossbow squads unless another effect overrides the TN modifier.
- **Reloading is automatic:** ranged units receive reloading cooldowns after firing, and the dashboard highlights their status as “Reloading” until the timer expires.

## For Developers
- Entry point: `scripts/index.js` wires up hooks, sheet registration, and world settings.
- Combat logic lives under `scripts/features/` and `scripts/logic/`.
- UI templates are in `templates/`, styles in `styles/`, and localisation strings in `lang/en.json`.
- Heat of Battle tables are defined in `scripts/logic/hob-db.js`.

## Compatibility Notes
- Targeted Foundry version: **v13**.
- System requirement: **WFRP4e v6+**.
- All squad state is stored on actors under `flags.wfrp4e-squads.*`, so no system schema modifications are required.
