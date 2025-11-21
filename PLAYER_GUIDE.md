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
- **Disorganized Threshold**: Whenever morale drops below 25% the unit automatically gains Disorganized until it is cleared (for example, by Reorganization).【F:scripts/features/actions.js†L176-L178】【F:scripts/index.js†L27-L33】

### Attack Resolution at a Glance
- **Target Number (TN):** Starts at 40 and rises by +7 per Experience tier and +5 per Equipment tier, then applies weapon accuracy, role bonuses, effect dice, and any hybrid-role penalty. Morale below 30% reduces TN by 10 and squads at 0 HP take −20. Specialists cap their effective TN at 90 and scale it to current HP%.【F:scripts/features/actions.js†L207-L246】
- **Hit Check:** A d100 roll must fall at or under the final TN. Heat of Battle or aesthetic triggers can further adjust TN mid-roll before the check resolves.【F:scripts/features/actions.js†L226-L244】
- **Damage:** Successful attacks roll 1d20 plus Experience d10s, weapon and role dice, and effect dice, then scale the total by current HP% (to a 20% floor). Armor, defense, and resistance soak reduce the blow before post-attack effects apply.【F:scripts/features/actions.js†L292-L356】【F:scripts/features/actions.js†L379-L439】
- **Chip Damage on Miss:** Failed rolls still deal 1d10 chip damage (plus any guard strain) and can inflict morale loss on the target, keeping pressure up even on bad rolls.【F:scripts/features/actions.js†L246-L291】

### Attack Resolution at a Glance
- **Target Number (TN):** Starts at 40 and rises by +7 per Experience tier and +5 per Equipment tier, then applies weapon accuracy, role bonuses, effect dice, and any hybrid-role penalty. Morale below 30% reduces TN by 10 and squads at 0 HP take −20. Specialists cap their effective TN at 90 and scale it to current HP%.【F:scripts/features/actions.js†L207-L246】
- **Hit Check:** A d100 roll must fall at or under the final TN. Heat of Battle or aesthetic triggers can further adjust TN mid-roll before the check resolves.【F:scripts/features/actions.js†L226-L244】
- **Damage:** Successful attacks roll 1d20 plus Experience d10s, weapon and role dice, and effect dice, then scale the total by current HP% (to a 20% floor). Armor, defense, and resistance soak reduce the blow before post-attack effects apply.【F:scripts/features/actions.js†L292-L356】【F:scripts/features/actions.js†L379-L439】
- **Chip Damage on Miss:** Failed rolls still deal 1d10 chip damage (plus any guard strain) and can inflict morale loss on the target, keeping pressure up even on bad rolls.【F:scripts/features/actions.js†L246-L291】

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

## Origins & Passives
- Pick an **Origin** from the Passive Effects column and click **Manage Passives** to toggle the appropriate traits. Only options tied to the chosen origin appear in the dialog.
- Origin bonuses apply automatically to damage, morale loss, TN checks, and soak. Passive toggles layer additional perks or drawbacks on top of the baseline heritage.

### Human
- **Origin:** Stoic drilled troops shrug off 5 HP and 5 Morale damage from every source.
- **Battle Drill:** +10 TN on maneuvers.
- **Resilient:** A further 5 HP/Morale damage reduction.
- **Adaptive:** When below half HP, maneuvers gain another +10 TN.
- **Well Equipped:** +5 armor soak on every hit.
- **To the Bitter End!:** The first time Morale hits 0, the unit instantly rallies (restores 4d20 Morale, clears Routed/Disorganized) without spending CP.

### Dwarf
- **Origin:** Magical assaults lose 25% of their HP/Morale impact against dwarfs.
- **Iron Will:** −20 Morale damage from any source.
- **Mastercrafted Armor:** +10 armor soak.
- **Ancestral Grudge:** +20 HP damage when striking Greenskins or Ratmen.
- **Grudgin’:** Every time the unit takes HP damage it banks +5 TN (up to +20) for future attacks and maneuvers.
- **Stalwart:** While Braced, gain an extra +10 armor soak.

### Elf
- **Origin:** Add +10 HP damage to every successful attack.
- **Elven Grace:** +10 TN on attacks and maneuvers.
- **Swift:** After suffering HP damage, the next maneuver gains +20 TN.
- **Superior Reflexes:** Reduce incoming melee damage by 10 and ranged damage by 5.
- **Elven Weaponry:** Another +10 HP damage on attacks (stacking with the origin bonus).
- **Aesthetic Perfection:** If the attack roll is under 10% of the TN, treat it as a critical success and trigger Heat of Battle.

### Monster
- **Origin:** Terrifying blows add +10 Morale damage, while incoming HP/Morale damage is reduced by 20%.
- **Bulky:** +10 HP damage but −10 attack TN.
- **Regeneration:** Heals 1d20 + 10 HP at the top of each round.
- **Thick Hide:** Gain +3d10 + 5 armor soak whenever hit.
- **Predator Instinct:** Targets under half Morale suffer +30 extra Morale damage, but the monster takes +20 HP damage from every hit.
- **Lurker:** Treat all targets as Flanked for advantage on defenses.
- **Multiple Appendages:** Make two melee attacks each turn, add +1d10 chip damage, and suffer −20 attack TN.
- **Horror Incarnate:** +40 Morale damage per strike, −20 attack TN.
- **Colossal:** +30 HP damage dealt, but ranged attacks deal +30 HP damage back.
- **Devourer:** Devouring allies (same side) restores 3d10 + 20 HP.
- **Monstrous Charge:** Charge attacks add an extra 1d20 damage, but the monster’s attack TN drops by 10 and incoming damage increases by 30.

### Greenskin
- **Origin:** As long as HP exceeds 50%, add +10 HP damage to attacks.
- **Surge:** Every fourth round the unit surges, gaining +20 HP damage and +10 attack TN for that round.
- **Mob Mentality:** If the squad suffers ≥50% HP damage in a round, next round’s attacks deal +4d10 + 10 Morale damage; while above half HP incoming Morale damage is halved.
- **Gobbos:** Rowdy mobs take +20 incoming HP damage and suffer −10 attack TN.
- **Big Choppas:** Ignore an additional 10 points of armor soak.
- **Unstoppable Wave:** Charges inflict +40 Morale damage, at the cost of a permanent −20 attack TN penalty.

### Ratmen
- **Origin:** Skittish fighters take +5 Morale damage from all sources and gain +10 TN on Flank maneuvers.
- **Coward:** Incoming Morale damage increases by 20; if Flanked they also take +20 HP damage.
- **Poisoner:** Successful attacks impose −20 TN on the target for 2 rounds.
- **Musk of Fear:** When the army is healthy (>50% HP), reduce incoming Morale damage by 25%; if the army falters, increase it by 50%.
- **Treacherous:** Attacking an ally grants +40 attack TN and +10 HP damage for 2 rounds.
- **Numerous:** AoE and artillery deal +40 HP damage to the unit; targets struck gain *Overwhelmed* (+10 Morale damage taken, −5 TN).

### Undead
- **Origin:** Unfeeling ranks shrug off 10 Morale damage from every source.
- **Puppet:** Mindless hordes suffer −10 attack/maneuver TN, −10 HP/Morale damage, and cannot use weapon maneuvers. If at least one “master” undead (Undead origin without Puppet, Morale > 0) is on the battlefield, puppets gain +5 damage and a further −10 Morale damage taken.
- **Life Drain:** Successful attacks heal the unit for 50% of the final HP damage dealt (rounded down), unless the target is also a Puppet.
- **Regeneration:** At the end of each turn the unit restores 2d10 + 10 HP, even while Unbound.
- **Ethereal:** Non-magical attacks deal half damage after soak, every strike adds +20 Morale damage, and 25% of HP damage ignores armor soak.
- **Crumbling:** When Morale hits 0, Undead do not route; they instead suffer 3d10 + 20 HP damage at the start of each turn.
- **March of the Dead:** While Morale > 0, every damaging hit inflicts *Overwhelmed* on the victim, and every 100 HP lost lets the unit roll 1d2 to raise 30 + 3d10 HP back into the formation (fails on a 2). The effect shuts down once the unit becomes Unbound.

### Chaos
- **Origin:** Chaotic warbands deal +10 HP damage and +10 Morale damage on every attack and shrug off 10 Morale loss. A random mutation is assigned the first time they strike, unlocking bespoke bonuses such as armor spikes, armor-piercing claws, flanking shadowplay, or regeneration.【F:scripts/logic/origins.js†L503-L534】【F:scripts/logic/origins.js†L928-L958】【F:scripts/passives/chaos.js†L1-L109】
- **Daemonic:** Adds another +5 HP and +20 Morale damage. When the unit’s Morale hits 0 it gains a banishing tag that bleeds 5 + 3d10 HP at the start of each turn until removed.【F:scripts/logic/origins.js†L503-L511】【F:scripts/logic/origins.js†L961-L1047】
- **Forged:** Grants +10 Morale damage on attacks and +10 armor soak on defense, making the unit harder to crack.【F:scripts/logic/origins.js†L503-L513】【F:scripts/logic/origins.js†L445-L463】
- **Frenzy:** Attack and maneuver TN rise as the squad loses HP (roughly +12 per 10% of HP missing), encouraging reckless assaults when bloodied.【F:scripts/logic/origins.js†L349-L375】
- **Corruptive:** Successful hits stack *Chaos Corrupted* on enemies, ramping Morale damage by up to 5 stacks over time. Hitting 5 stacks triggers a 10% chance to gift the victim a random mutation; stacks stay as an active effect until combat ends.【F:scripts/logic/origins.js†L815-L839】【F:scripts/index.js†L36-L42】

### Mage Maneuvers (Hard, CD 4 unless noted)
- **Channel Magic** (Average, self): Prerequisite to cast. Grants the Channelled Magic status.
- **Firestorm** (enemy): 4d20 HP and 6d20 Morale damage in a roaming 4-yard blaze that pulses once per round for 3 rounds.
- **Fireball** (enemy): 20 + 3d10 HP and Morale damage with a dramatic chat recap.
- **Doom & Gloom** (enemy): Drains 50 + 5d10 Morale and inflicts −2d20 TN for 2 rounds.
- **Transmutation of Lead** (enemy): Strips Equipment Tier ×1d10 soak for 2 rounds.
- **Magical Revification** (ally): Restores 20 + 2d20 HP and 10 + 3d20 Morale.
- **Fire Aspect** (ally): Grants +4d10 TN, +3d20 Damage, and +1d20 Defense for 2 rounds.
- **Spell Damage Callouts**: Successful magical damage posts the actual HP loss to chat, making it easy to narrate spell impacts.【F:scripts/features/actions.js†L191-L197】

### Engineer Maneuvers (Average/Hard, CD 2)
- **Line Defense** (self): Deploys a barricade zone that grants +2d10 soak and Fortified/Braced tags to allies standing inside (the bonus ends as soon as they leave) for 4 rounds.
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
- **Overwhelmed** – Ratmen hordes and undead marches pile on, increasing incoming Morale damage by 10 and imposing −5 TN until the effect expires.
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
