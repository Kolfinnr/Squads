# WFRP4e – Squads (Foundry v13)

Lightweight module that adds a **Squad** actor type for Warhammer Fantasy Roleplay 4e with:
- HP, **Morale** (0–100), **Experience tier** (0–5), **Equipment tier** (0–10)
- Three actions (Maneuver, Melee, Ranged) rolling **1d100** vs derived TN
- Simple derived stats on the sheet (Attack/Defense bonus, Capacity)

## Install
1. Copy the folder to `Data/modules/wfrp4e-squads/`.
2. Launch Foundry → *Manage Modules* → enable **WFRP4e – Squads**.
3. Create Actor → **type: squad** → open and click action buttons.

## Structure
- `scripts/index.js` — Foundry wiring (hooks, sheet registration)
- `scripts/config.js` — ids, tuning knobs (base TN, min/max)
- `scripts/domain/*` — pure logic (derived, pressure modifiers)
- `scripts/features/*` — behaviors (actions, creation seed)
- `scripts/services/*` — utilities (chat)
- `scripts/sheets/*` — Actor sheet class & UI
- `templates/squad-sheet.hbs` — handlebars sheet
- `styles/squads.css` — minimal styling
- `lang/en.json` — i18n keys

## Notes
- Targets Foundry **v13**. Uses ESM with plain `.js` files.
- We **do not** modify WFRP4e system schema; we store fields under `system.squad`.
- Tweak formulas in:
  - `domain/squad-model.js` (`getDerived`)
  - `features/actions.js` (TN & damage)

## Roadmap
- Morale checks (broken/rout) and recovery
- Unit Size & attrition (damage scales with models)
- Opposed tests vs WFRP4e actors
- Settings panel for Base TN, thresholds
