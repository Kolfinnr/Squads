function makeEvent(key, title, text, handler) {
  return {
    key,
    title,
    text,
    apply: (actor, context = {}) => handler(actor, context)
  };
}

export function buildHoBDatabase(helpers) {
  const {
    rollFormula,
    adjustMorale,
    adjustHP,
    addEffect,
    removeDisorganized,
    removeTired,
    removeFirstNegative,
    removePositiveEffects,
    alliedSquadActors,
    randomActor,
    buildDetail,
    immediateFromRoll,
    setActorFlag,
    getActorFlag
  } = helpers;

  const morale = [
    makeEvent("banner-falls", "Banner Falls!", "−2d20 Morale.", async (actor) => {
      const roll = await rollFormula("2d20");
      await adjustMorale(actor, -roll.total);
      return buildDetail(`-${roll.total} Morale (${roll.formula})`);
    }),
    makeEvent("panic-spreads", "Panic Spreads", "Disorganized, −1d10 TN.", async (actor) => {
      await addEffect(actor, {
        key: "hob-panic-spreads",
        label: "Panic Spreads",
        duration: 2,
        mods: { tnDice: "-1d10", defPenaltyDice: "-1d20", tags: { disorganized: true } }
      });
      return buildDetail("Disorganized (2) & −1d10 TN");
    }),
    makeEvent("surrender-whispers", "Surrender Whispers", "−1d20 Morale, −1d10 TN.", async (actor) => {
      const roll = await rollFormula("1d20");
      await adjustMorale(actor, -roll.total);
      await addEffect(actor, {
        key: "hob-surrender-whispers",
        label: "Surrender Whispers",
        duration: 2,
        mods: { tnDice: "-1d10" }
      });
      return buildDetail(`-${roll.total} Morale (${roll.formula}) & −1d10 TN`);
    }),
    makeEvent("rallying-cry", "Rallying Cry", "+2d10 Morale.", async (actor) => {
      const roll = await rollFormula("2d10");
      await adjustMorale(actor, roll.total);
      return buildDetail(`+${roll.total} Morale (${roll.formula})`);
    }),
    makeEvent("frenzied-desperation", "Frenzied Desperation", "+1d10 TN, +1d10 Damage.", async (actor) => {
      const tnRoll = await rollFormula("1d10");
      const dmgRoll = await rollFormula("1d10");
      await addEffect(actor, {
        key: "hob-frenzied-desperation",
        label: "Frenzied Desperation",
        duration: 1,
        mods: { tnDice: "+1d10", dmgDice: "+1d10" }
      });
      return buildDetail("+1d10 TN & +1d10 Damage", {
        tn: [immediateFromRoll(tnRoll)],
        damage: [immediateFromRoll(dmgRoll)]
      });
    }),
    makeEvent("faith-rekindled", "Faith Rekindled", "+3d10 Morale.", async (actor) => {
      const roll = await rollFormula("3d10");
      await adjustMorale(actor, roll.total);
      return buildDetail(`+${roll.total} Morale (${roll.formula})`);
    }),
    makeEvent("hold-the-line", "Hold the Line!", "+1d10 Defense.", async (actor) => {
      await addEffect(actor, {
        key: "hob-hold-the-line",
        label: "Hold the Line!",
        duration: 1,
        mods: { defSoakDice: "+1d10" }
      });
      return buildDetail("+1d10 Defense (1 round)");
    }),
    makeEvent("fear-turns-to-rage", "Fear Turns to Rage", "Remove Fear, +1d10 Damage.", async (actor) => {
      if (getActorFlag(actor, "fear")) {
        await setActorFlag(actor, "fear", false);
      }
      const dmgRoll = await rollFormula("1d10");
      await addEffect(actor, {
        key: "hob-fear-turns-to-rage",
        label: "Fear Turns to Rage",
        duration: 1,
        mods: { dmgDice: "+1d10" }
      });
      return buildDetail("Fear removed, +1d10 Damage", {
        damage: [immediateFromRoll(dmgRoll)]
      });
    }),
    makeEvent("despair-overwhelms", "Despair Overwhelms", "−3d10 Morale, Tired.", async (actor) => {
      const roll = await rollFormula("3d10");
      await adjustMorale(actor, -roll.total);
      await addEffect(actor, {
        key: "hob-despair-overwhelms",
        label: "Despair Overwhelms",
        duration: 2,
        mods: { tags: { tired: true } }
      });
      return buildDetail(`-${roll.total} Morale (${roll.formula}) & Tired`);
    }),
    makeEvent("heroic-rally", "Heroic Rally!", "+5d10 Morale, remove Disorganized.", async (actor) => {
      const roll = await rollFormula("5d10");
      await adjustMorale(actor, roll.total);
      await removeDisorganized(actor);
      return buildDetail(`+${roll.total} Morale (${roll.formula}) & remove Disorganized`);
    })
  ];

  const hp = [
    makeEvent("commander-slain", "Commander Slain", "−2d20 Morale.", async (actor) => {
      const roll = await rollFormula("2d20");
      await adjustMorale(actor, -roll.total);
      return buildDetail(`-${roll.total} Morale (${roll.formula})`);
    }),
    makeEvent("heavy-losses", "Heavy Losses", "−2d20 HP.", async (actor) => {
      const roll = await rollFormula("2d20");
      await adjustHP(actor, -roll.total);
      return buildDetail(`-${roll.total} HP (${roll.formula})`);
    }),
    makeEvent("mud-and-blood", "Mud and Blood", "Disorganized 2 rds.", async (actor) => {
      await addEffect(actor, {
        key: "hob-mud-and-blood",
        label: "Mud and Blood",
        duration: 2,
        mods: { defPenaltyDice: "-1d20", tags: { disorganized: true } }
      });
      return buildDetail("Disorganized (2 rounds)");
    }),
    makeEvent("reinforcements", "Reinforcements", "+1d20 HP.", async (actor) => {
      const roll = await rollFormula("1d20");
      await adjustHP(actor, roll.total);
      return buildDetail(`+${roll.total} HP (${roll.formula})`);
    }),
    makeEvent("battlefield-medic", "Battlefield Medic", "+1d10 HP, remove Tired.", async (actor) => {
      const roll = await rollFormula("1d10");
      await adjustHP(actor, roll.total);
      await removeTired(actor);
      return buildDetail(`+${roll.total} HP (${roll.formula}) & remove Tired`);
    }),
    makeEvent("desperate-push", "Desperate Push", "+2d10 Damage, Tired.", async (actor) => {
      const roll = await rollFormula("2d10");
      await addEffect(actor, {
        key: "hob-desperate-push",
        label: "Desperate Push",
        duration: 1,
        mods: { dmgDice: "+2d10", tags: { tired: true } }
      });
      return buildDetail("+2d10 Damage & Tired", {
        damage: [immediateFromRoll(roll)]
      });
    }),
    makeEvent("broken-formation", "Broken Formation", "Lose all Defense for 1 rd.", async (actor) => {
      await addEffect(actor, {
        key: "hob-broken-formation",
        label: "Broken Formation",
        duration: 1,
        mods: { tags: { noDefense: true } }
      });
      return buildDetail("No Defense (1 round)");
    }),
    makeEvent("cohesion-restored", "Cohesion Restored", "Remove Disorganized, +1d10 HP.", async (actor) => {
      const roll = await rollFormula("1d10");
      await removeDisorganized(actor);
      await adjustHP(actor, roll.total);
      return buildDetail(`+${roll.total} HP (${roll.formula}) & remove Disorganized`);
    }),
    makeEvent("too-many-dead", "Too Many Dead", "−1d20 Morale, −1d10 TN.", async (actor) => {
      const moraleRoll = await rollFormula("1d20");
      const tnRoll = await rollFormula("1d10");
      await adjustMorale(actor, -moraleRoll.total);
      await addEffect(actor, {
        key: "hob-too-many-dead",
        label: "Too Many Dead",
        duration: 2,
        mods: { tnDice: "-1d10" }
      });
      return buildDetail(`-${moraleRoll.total} Morale (${moraleRoll.formula}) & −1d10 TN`, {
        tn: [immediateFromRoll(tnRoll)]
      });
    }),
    makeEvent("glorious-resistance", "Glorious Resistance", "Take half damage 1 rd.", async (actor) => {
      await addEffect(actor, {
        key: "hob-glorious-resistance",
        label: "Glorious Resistance",
        duration: 1,
        mods: { tags: { halfDamage: true } }
      });
      return buildDetail("Take half damage (1 round)");
    })
  ];

  const good = [
    makeEvent("blades-of-glory", "Blades of Glory", "Double this attack’s damage.", async () => ({
      detail: buildDetail("Double damage this attack"),
      damageMultiplier: 2
    })),
    makeEvent("standard-raised", "Standard Raised", "Allies gain +1d10 Morale.", async (actor) => {
      const roll = await rollFormula("1d10");
      const allies = alliedSquadActors(actor, { includeSelf: true });
      for (const ally of allies) {
        await adjustMorale(ally, roll.total);
      }
      return buildDetail(`All allies +${roll.total} Morale (${roll.formula})`);
    }),
    makeEvent("inspired-valor", "Inspired Valor", "Auto-pass next maneuver.", async (actor) => {
      await setActorFlag(actor, "hob_autoPassManeuver", true);
      return buildDetail("Auto-pass next maneuver");
    }),
    makeEvent("flawless-coordination", "Flawless Coordination", "Ignore penalties for 1 rd.", async (actor) => {
      await addEffect(actor, {
        key: "hob-flawless-coordination",
        label: "Flawless Coordination",
        duration: 1,
        mods: { tags: { ignorePenalties: true } }
      });
      return buildDetail("Ignore penalties (1 round)");
    }),
    makeEvent("enemy-falters", "Enemy Falters", "Target −1d20 TN next round.", async (actor, context) => {
      const target = context?.target;
      if (target) {
        await addEffect(target, {
          key: "hob-enemy-falters",
          label: "Enemy Falters",
          duration: 1,
          mods: { tnDice: "-1d20" }
        });
        return buildDetail("Target −1d20 TN next round");
      }
      return buildDetail("Enemy falters (no target)");
    }),
    makeEvent("banner-of-victory", "Banner of Victory", "+3d10 Morale.", async (actor) => {
      const roll = await rollFormula("3d10");
      await adjustMorale(actor, roll.total);
      return buildDetail(`+${roll.total} Morale (${roll.formula})`);
    }),
    makeEvent("surge-forward", "Surge Forward", "Move or charge 5m extra.", async (actor) => {
      await addEffect(actor, {
        key: "hob-surge-forward",
        label: "Surge Forward",
        duration: 1,
        mods: { tags: { freeMove: true, charged: true } }
      });
      return buildDetail("Gain extra movement/charge this round");
    }),
    makeEvent("righteous-fury", "Righteous Fury", "+2d20 Damage.", async (actor) => {
      const roll = await rollFormula("2d20");
      await addEffect(actor, {
        key: "hob-righteous-fury",
        label: "Righteous Fury",
        duration: 1,
        mods: { dmgDice: "+2d20" }
      });
      return buildDetail("+2d20 Damage", { damage: [immediateFromRoll(roll)] });
    }),
    makeEvent("protect-the-fallen", "Protect the Fallen", "+1d10 HP.", async (actor) => {
      const roll = await rollFormula("1d10");
      await adjustHP(actor, roll.total);
      return buildDetail(`+${roll.total} HP (${roll.formula})`);
    }),
    makeEvent("divine-intervention", "Divine Intervention", "Cancel one debuff.", async (actor) => {
      const removed = await removeFirstNegative(actor);
      return buildDetail(removed ? "One debuff removed" : "No debuff to remove");
    })
  ];

  const bad = [
    makeEvent("weapon-break", "Weapon Break", "Attack fails, −2d10 TN next round.", async (actor) => {
      const roll = await rollFormula("2d10");
      await addEffect(actor, {
        key: "hob-weapon-break",
        label: "Weapon Break",
        duration: 1,
        mods: { tnDice: "-2d10" }
      });
      return {
        detail: buildDetail("Attack fails & −2d10 TN next round", { tn: [immediateFromRoll(roll)] }),
        damageMultiplier: 0
      };
    }),
    makeEvent("friendly-fire", "Friendly Fire", "1d10 HP damage to ally.", async (actor) => {
      const roll = await rollFormula("1d10");
      const allies = alliedSquadActors(actor, { includeSelf: false });
      const target = randomActor(allies) || actor;
      await adjustHP(target, -roll.total);
      return buildDetail(`-${roll.total} HP to ally (${roll.formula})`);
    }),
    makeEvent("slip-in-the-mud", "Slip in the Mud", "Disorganized.", async (actor) => {
      await addEffect(actor, {
        key: "hob-slip-in-the-mud",
        label: "Slip in the Mud",
        duration: 1,
        mods: { defPenaltyDice: "-1d20", tags: { disorganized: true } }
      });
      return buildDetail("Disorganized (1 round)");
    }),
    makeEvent("panic-chain", "Panic Chain", "Ally −1d10 Morale.", async (actor) => {
      const roll = await rollFormula("1d10");
      const allies = alliedSquadActors(actor, { includeSelf: false });
      const target = randomActor(allies) || actor;
      await adjustMorale(target, -roll.total);
      return buildDetail(`-${roll.total} Morale to ally (${roll.formula})`);
    }),
    makeEvent("commander-hesitates", "Commander Hesitates", "Skip next turn.", async (actor) => {
      await addEffect(actor, {
        key: "hob-commander-hesitates",
        label: "Commander Hesitates",
        duration: 1,
        mods: { tags: { skipTurn: true } }
      });
      return buildDetail("Skip next turn");
    }),
    makeEvent("weapon-jam", "Weapon Jam", "Half damage.", async () => ({
      detail: buildDetail("Half damage"),
      damageMultiplier: 0.5
    })),
    makeEvent("poor-communication", "Poor Communication", "−1d10 TN for 2 rounds.", async (actor) => {
      const roll = await rollFormula("1d10");
      await addEffect(actor, {
        key: "hob-poor-communication",
        label: "Poor Communication",
        duration: 2,
        mods: { tnDice: "-1d10" }
      });
      return buildDetail("−1d10 TN for 2 rounds", { tn: [immediateFromRoll(roll)] });
    }),
    makeEvent("trampled-bodies", "Trampled Bodies", "−1d10 HP.", async (actor) => {
      const roll = await rollFormula("1d10");
      await adjustHP(actor, -roll.total);
      return buildDetail(`-${roll.total} HP (${roll.formula})`);
    }),
    makeEvent("chaos-in-the-ranks", "Chaos in the Ranks", "Lose all buffs.", async (actor) => {
      await removePositiveEffects(actor);
      await addEffect(actor, {
        key: "hob-chaos-in-the-ranks",
        label: "Chaos in the Ranks",
        duration: 1,
        mods: { defPenaltyDice: "-1d20", tags: { disorganized: true } }
      });
      return buildDetail("Lose buffs & become Disorganized");
    }),
    makeEvent("utter-rout", "Utter Rout!", "Morale test or flee.", async (actor) => {
      const morale = Number(getActorFlag(actor, "morale") || 0);
      const roll = await rollFormula("1d100");
      if (roll.total > morale) {
        await setActorFlag(actor, "morale", 0);
        await addEffect(actor, {
          key: "hob-utter-rout",
          label: "Utter Rout",
          duration: 2,
          mods: { tags: { skipTurn: true, disengaged: true, disorganized: true } }
        });
        return buildDetail(`Fails morale test (${roll.formula}=${roll.total}) and flees`);
      }
      return buildDetail(`Holds after morale test (${roll.formula}=${roll.total})`);
    })
  ];

  return { morale, hp, good, bad };
}
