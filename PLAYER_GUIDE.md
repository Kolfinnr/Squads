# WFRP4e Squads — Player Reference

## Core Concepts

### Squad Stats and States
- **HP / HP Max**: Track the formation’s current strength. Damage reduces HP; when it reaches 0 the unit is spent.
- **Morale / Morale Max**: Represents cohesion and willingness to fight. Many effects raise or lower morale.
- **Experience Tier & Equipment Tier**: Improve target numbers (TN) and damage output. Equipment also contributes to defensive soak.
- **Role & Weapon**: Determine role bonuses and which weapon maneuvers are available.
- **Traits**: Flags such as Fear, Terror, and Unbreakable influence morale loss and special rules.
- **Effects**: Temporary buffs or penalties listed on the sheet and dashboard. Green chips are boons; red chips are debuffs.
- **Cooldowns**: Show abilities or commands waiting to refresh. The command dashboard displays remaining rounds and special statuses such as Reloading.
- **Turn Timers**: Durations and cooldowns tick at the start of a squad’s turn; the UI now reports remaining turns rather than generic rounds.
- **Disorganized Threshold**: Whenever morale drops below 50% the unit automatically gains Disorganized until it is cleared (for example, by Reorganization).

### Orders & Maneuver Toggle
- Each squad can hold a current **Order** (Move, Attack, Idle, or blank). Use the dashboard or sheet to note plans.
- A **Maneuver** checkbox beside the orders column is a reminder for players planning to perform a maneuver that round.
- Squad sheets now offer a **Backline Attack** toggle; when enabled the unit performs rear assaults (see Melee Actions below).

### Command Points (CP)
- Commanders start with a default pool (3 of 6). Spending CP triggers command abilities. Adjustments appear on the dashboard, and the pool refills only through in-game rewards or GM fiat.

## Specialist Roles
- Set a squad’s role to **Specialist** and choose a subtype (Mage or Engineer) on the sheet.
- Specialists use the standard TN formula, but their effective chance is capped at 90 and then scaled by current HP%. As formations weaken their spellcraft or engineering becomes harder to execute.
- Specialist maneuvers track individual cooldowns (4 rounds for spells, 2 rounds for engineering actions). The squad sheet lists each specialist ability with its base cooldown and remaining turns alongside the dashboard badges.
- Mage spells require **Channel Magic** first; failing the channel invokes **Minor Perils** while failed spells trigger **Major Perils**. Engineers risk **Engineering Mishaps** on failed maneuvers.

### Mage Maneuvers (Hard, CD 4 unless noted)
- **Channel Magic** (Average, self): Prerequisite to cast. Grants the Channelled Magic status.
- **Firestorm** (enemy): 4d20 HP and 6d20 Morale damage in a roaming 4-yard blaze that pulses once per round for 3 rounds.
- **Fireball** (enemy): 20 + 3d10 HP and Morale damage with a dramatic chat recap.
- **Doom & Gloom** (enemy): Drains 50 + 5d10 Morale and inflicts −2d20 TN for 2 rounds.
- **Transmutation of Lead** (enemy): Strips Equipment Tier ×1d10 soak for 2 rounds.
- **Magical Revification** (ally): Restores 20 + 2d20 HP and 10 + 3d20 Morale.
- **Fire Aspect** (ally): Grants +4d10 TN, +3d20 Damage, and +1d20 Defense for 2 rounds.

### Engineer Maneuvers (Average/Hard, CD 2)
- **Line Defense** (self): Deploys a barricade zone that grants +2d10 soak and Fortified/Braced tags to allies standing inside (the bonus ends as soon as they leave) for 3 rounds.
- **Minefield** (enemy): Deals 3d20 HP and 4d20 Morale, leaving the foe Disorganized.
- **Wolf Pits** (enemy): 2d10 HP and 2d10 Morale damage plus a skip-turn snare.
- **Flashbombs** (enemy): Blinds the target with −(50 + 5d10) TN and Disorganized for 2 rounds.
- **Fortify Position** (self): Establishes a 3.5-yard fortification that grants +10 + 2d10 soak and Fortified to allies inside; the engineer also gains Deep Defense (20 + 2d20 soak) and becomes Immobile while within the bastion.
- **Ballistic Calibration** (ally): +5d10 TN to a ranged ally for 6 rounds.
- Failed engineering maneuvers roll on the Mishap table; one result grants a “Spark of Genius” auto-pass on the next attempt.

## Command Actions
| Command | Cost | Effect |
| --- | --- | --- |
| **Ranged! Fire at the Target!** | 2 CP | Selected squad immediately performs a ranged attack and gains the `Ranged Command` cooldown for 3 rounds. |
| **New Orders!** | 1 CP | Clears current orders and maneuver reminder, then prompts for Melee, Ranged, or Hold. Posts the new order to chat. Commanders cannot receive orders. |
| **Rally!** | 1 CP | Clears Routed and Disorganized, then restores 4d20 Morale (units at 0 Morale stand back up at 1). |
| **Unit! Withdraw!** | 1 CP | Removes Flanked/Encircled tags and grants Withdraw for 1 round (+1d10 Defense soak, Disengaged). |
| **Intercept!** | 1 CP | Infantry squad within 3 tiles immediately Guard an allied unit, redirecting the next melee attack to themselves (+1d20 HP/+1d20 Morale strain) and marking them Spent for maneuvers. |
| **Player Special Action** | 1 CP | Prompts custom text and posts it to chat for narration. |
| **Get in Formation!** | 2 CP | Grants +8d10 maneuver TN bonus for 1 round. |

All command actions announce their use in chat and respect cooldown timers and permissions.

### Backline Attacks
- Enable the **Backline Attack** toggle on the squad sheet to represent cavalry or skirmishers striking from the rear.
- Backline assaults ignore Brace and Phalanx bonuses, add +2d10 HP damage, and inflict an extra 3d10 Morale loss.
- If the target’s Morale falls below 50% after the hit, it becomes Disorganized automatically. These strikes never apply the Flanked tag.

## Maneuvers
Each maneuver requires a maneuver roll using the squad’s TN plus difficulty modifiers. Failure applies **Disorganized (1)**. Effects last one round unless noted.

### Universal Maneuvers
- **Flank** (Average, enemy target): Apply −1d20 Defense (Flanked) for 2 rounds and inflict 1d20 Morale loss.
- **Reorganization** (Easy, self): Remove negative statuses (Tired/Disorganized), gain 2d20 Morale, but suffer −1d10 TN and −1d10 Defense soak for 1 round.
- **Charge** (Easy, self): +1d20 TN, +1d20 Damage, grants *Charged* tag.
- **Brace** (Easy, self): +1d10 Defense soak and *Braced* tag.
- **Loose Formation** (Easy, self): +1d20 Ranged Resistance, −1d20 Defense soak, grants *Loose Formation* tag.
- **Disengage** (Easy, self): +1d10 Defense soak and *Disengaged* tag.
- **Guard** (Easy, ally, CD 1, infantry only): Assign the squad to protect an adjacent ally. The next melee attack against that ally is redirected to the guard, dealing the normal result plus +1d20 HP and +1d20 Morale strain to the guarding unit while allowing the ally to disengage safely.

### Sword Maneuvers
- **Mordhau Swordsmanship** (Hard, self, CD 3): +5d10 TN, +4d10 Damage.
- **Riposte** (Average, self): +1d10 Defense soak.
- **Close the Gaps!** (Easy, self): +1d10 Morale, +1d10 Defense soak, −1d20 Ranged Resistance.

### Axe Maneuvers
- **Bestial Rage** (Hard, self): +3d20 Damage; also applies −1d20 TN, −1d20 Defense soak, *Tired*, and *Disorganized* for 1 round.
- **Nimble Fighters** (Average, self): +1d20 Defense soak, −1d20 TN.
- **Heavy Hits** (Easy, self): +1d20 Damage, −1d10 TN, −1d10 Defense soak.

### Polearm Maneuvers
- **Schiltron** (Hard, self): +5d10 Defense soak, grants immunity to Flanked/Encircled, +1d20 Morale.
- **Phalanx** (Average, self): +3d10 Defense soak and *Anti-Charge* tag.
- **Precise Hits** (Easy, self): +1d10 Damage, 25% armor ignore; also −1d10 Defense soak.

### Bow Maneuvers
- **Uncanny Shots** (Hard, self): +3d10 TN, +2d10 Damage, 25% armor ignore.
- **Volley Fire** (Average, self): Multi-shot 2 (damage split) and applies *Tired*.
- **Fire Arrows** (Easy, enemy): −1d20 TN and Damage this round; enemy loses 2d20 Morale and 1d10 HP.

### Crossbow Maneuvers
- **Volley Fire** (Hard, self, CD 2): Multi-shot 2 (damage split).
- **Take it Down!** (Average, self): +3d10 TN, +3d10 Damage.
- **Precise Hits** (Easy, self): −3d10 TN, gains armor piercing.

### Firearm Maneuvers
- **Aim Your Shots!** (Hard, self): Skip this turn; next round gain +3d10 TN and +6d10 Damage.
- **Continuous Fire** (Average, self): Continuous fire for 3 rounds, dealing half damage and applying sustained tags.
- **Reload!** (Easy, self): −1d20 Defense soak and *Tired* for 1 round while reloading.

### Artillery Maneuvers
- **Counter Battery Fire** (Hard, enemy): Immediately inflict 2d20 HP damage.
- **Entrench!** (Average, self): +4d10 Ranged Resistance, *Resist Charge Bonus* for 99 rounds (until dismissed).
- **Reload!** (Easy, self): Applies fast reload and *Tired* for 1 round.

### Hybrid Maneuvers
- **Smoke Bomb** (Average, self + ally): Grants a cover aura for the acting squad and one selected allied unit for 1 round.
- **Cripple** (Hard, enemy): Enemy loses 3d10 Morale, gains Disorganized with −1d20 Defense.
- **Ambush Setup** (Average, enemy/self): Enemy becomes Flanked (−1d20 Defense); acting squad gains +3d10 Damage.
- **Feint & Retreat** (Average, self): Damage halved but grants *Disengaged* tag for 1 round.
- **Shadowplay** (Hard, self): +3d10 Defense soak and *Free Move* tag.

### Mounted Maneuvers
- **Trample** (Average, enemy): Deal 1d10 HP and 1d20 Morale damage, force Loose Formation, but the squad becomes Disorganized.
- **Wheel About** (Average, self): Remove Flanked and gain +1d20 Defense soak next turn.
- **Breakthrough** (Hard, self): Clear debuffs on self and adjacent allies, then restore 2d20 Morale and announce the surge in chat.

## Active Effects Reference
The sheet and dashboard list active effects with coloured chips. Common statuses include:

- **Channelled Magic** – The mage has successfully channelled and may cast a spell. Casting or certain perils clear it.
- **Charged** – Granted by Charge maneuvers or HoB; adds extra TN/damage to the next melee attack.
- **Braced** – Defensive stance that adds soak and, for polearms, punishes charging foes.
- **Loose Formation** – Spreads out to resist ranged attacks (+ranged resistance, −defense soak).
- **Disengaged** – Easier withdrawal from melee; often paired with Withdraw or Guarded Withdrawal.
- **Guarding / Guarded** – An infantry unit intercepts melee hits for an ally; strain damage applies when the guard is struck.
- **Guarded Withdrawal** – The protected ally may disengage safely on its next turn.
- **Spent Maneuver** – The unit cannot attempt further maneuvers until the next turn (e.g., after Intercept!).
- **Fortified** – Heavy cover; immunity to Flanked while in fortifications and +10 + 2d10 soak.
- **Deep Defense** – Engineers inside their fortification gain an additional 20 + 2d20 soak versus incoming damage.
- **Immobile** – Unit cannot move or perform maneuvers that require movement (common for entrenched engineers).
- **Cover Aura** – Provided by smoke bombs and similar abilities; grants soft cover to units inside the zone.
- **Free Move** – Allows repositioning without provoking counter-attack (e.g., Shadowplay).
- **Continuous Fire / Half Damage** – Sustained ranged attack that halves outgoing damage while the barrage continues.
- **Skip Turn** – The unit forfeits its next activation.
- **Tired** – Standard fatigue penalty (−1d10 TN & damage, −1d20 defense) until cleared by Reorganization or rest.
- **Disorganized** – Severe cohesion loss (−1d20 TN & defense) applied on failed maneuvers or low morale; cleared by Reorganization/Rally.
- **Routed!** – Morale has fallen to 0; the unit flees until successfully rallied.
- **Fire Aspect** – Spell buff providing +TN, +damage, and +defense for 2 turns.

## Heat of Battle Tables (Roll 1d10)
Heat of Battle (HoB) events trigger automatically on doubles, or the first time HP or Morale drop below 30%. Roll on the corresponding table and apply the listed effects immediately.

### Morale Events
1. **Banner Falls!** – Lose 2d20 Morale.
2. **Panic Spreads** – Gain Disorganized (2) and −1d10 TN.
3. **Surrender Whispers** – Lose 1d20 Morale and suffer −1d10 TN for 2 rounds.
4. **Rallying Cry** – Gain 2d10 Morale.
5. **Frenzied Desperation** – +1d10 TN and +1d10 Damage for 1 round.
6. **Faith Rekindled** – Gain 3d10 Morale.
7. **Hold the Line!** – +1d10 Defense for 1 round.
8. **Fear Turns to Rage** – Remove Fear trait and gain +1d10 Damage.
9. **Despair Overwhelms** – Lose 3d10 Morale and gain *Tired*.
10. **Heroic Rally!** – Gain 5d10 Morale and remove Disorganized.

### HP Events
1. **Commander Slain** – Lose 2d20 Morale.
2. **Heavy Losses** – Lose 2d20 HP.
3. **Mud and Blood** – Gain Disorganized with −1d20 Defense for 2 rounds.
4. **Reinforcements** – Recover 1d20 HP.
5. **Battlefield Medic** – Recover 1d10 HP and remove *Tired*.
6. **Desperate Push** – +2d10 Damage but become *Tired*.
7. **Broken Formation** – No Defense for 1 round.
8. **Cohesion Restored** – Remove Disorganized and recover 1d10 HP.
9. **Too Many Dead** – Lose 1d20 Morale and suffer −1d10 TN for 2 rounds.
10. **Glorious Resistance** – Take half damage for 1 round.

### Critical Success (Good Events)
1. **Blades of Glory** – Double this attack’s damage.
2. **Standard Raised** – All allied squads gain 1d10 Morale.
3. **Inspired Valor** – Auto-pass the next maneuver.
4. **Flawless Coordination** – Ignore penalties for 1 round.
5. **Enemy Falters** – Target suffers −1d20 TN next round.
6. **Banner of Victory** – Gain 3d10 Morale.
7. **Surge Forward** – Gain extra movement/charge options this round.
8. **Righteous Fury** – +2d20 Damage for 1 round.
9. **Protect the Fallen** – Recover 1d10 HP.
10. **Divine Intervention** – Remove one debuff effect.

### Critical Failure (Bad Events)
1. **Weapon Break** – Attack fails and −2d10 TN next round.
2. **Friendly Fire** – Ally suffers 1d10 HP damage.
3. **Slip in the Mud** – Become Disorganized for 1 round.
4. **Panic Chain** – Random ally loses 1d10 Morale.
5. **Commander Hesitates** – Skip next turn.
6. **Weapon Jam** – Damage is halved.
7. **Poor Communication** – −1d10 TN for 2 rounds.
8. **Trampled Bodies** – Lose 1d10 HP.
9. **Chaos in the Ranks** – Remove all buffs and become Disorganized.
10. **Utter Rout!** – Morale test or flee (sets Morale to 0 and applies severe penalties on failure).

## Using This Guide at the Table
1. **Open the Squad Sheet** for each unit to check stats, effects, and orders.
2. **Use the Command Dashboard** for CP actions, quick order changes, and to monitor HP/Morale/Effects across the formation.
3. **Track Cooldowns**: Ranged command, maneuvers, and reload states display remaining rounds automatically after each combat round advances.
4. **Watch for HoB Messages**: Chat cards summarize HoB rolls, applied effects, and any multipliers so you can narrate dramatic swings without extra lookup.

Keep this reference handy so players and GMs can quickly resolve maneuvers, commands, and Heat of Battle swings during large engagements.
