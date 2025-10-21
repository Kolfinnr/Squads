// scripts/logic/maneuvers.js
import { FLAG_SCOPE } from "../config.js";
import { addEffect, clearNegative } from "./effects.js";
import { setCooldown } from "./cooldowns.js";

const E = (mods, duration=1, key=null, label=null)=>({
  key: key || crypto.randomUUID?.() || Math.random().toString(36).slice(2),
  label: label || "Effect",
  duration, mods
});
async function addMorale(actor, dice){
  const r = await (new Roll(dice).roll({async:true}));
  const cur = actor.getFlag(FLAG_SCOPE,"morale")||0;
  const max = actor.getFlag(FLAG_SCOPE,"moraleMax")||0;
  await actor.setFlag(FLAG_SCOPE,"morale", Math.min(max, cur + r.total));
}
async function subMorale(actor, dice){
  const r = await (new Roll(dice).roll({async:true}));
  const cur = actor.getFlag(FLAG_SCOPE,"morale")||0;
  await actor.setFlag(FLAG_SCOPE,"morale", Math.max(0, cur - r.total));
}

export const MANEUVERS = {
  /* ===== UNIVERSAL ===== */
  flank:   { name:"Flank",   category:"universal", difficulty:"average", target:"enemy",
    apply: async ({target}) => { await addEffect(target, E({ defPenaltyDice:"-1d20", tags:{ flanked:true } }, 2, "flanked","Flanked")); await subMorale(target,"1d20"); } },
  reorg:   { name:"Reorganization", category:"universal", difficulty:"easy", target:"self",
    apply: async ({actor}) => { await clearNegative(actor); await addMorale(actor,"2d20"); await addEffect(actor, E({ tnDice:"-1d10", defSoakDice:"-1d10" },1,"reorg-pen","Reorg Penalty")); } },
  charge:  { name:"Charge",  category:"universal", difficulty:"easy", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ tnDice:"+1d20", dmgDice:"+1d20", tags:{ charged:true } },1,"charge","Charge")); } },
  brace:   { name:"Brace",   category:"universal", difficulty:"easy", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ defSoakDice:"+1d10", tags:{ braced:true } },1,"brace","Brace")); } },
  loose:   { name:"Loose Formation", category:"universal", difficulty:"easy", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ rangedResistDice:"+1d20", defPenaltyDice:"-1d20", tags:{ looseFormation:true } },1,"loose","Loose Formation")); } },
  disengage:{ name:"Disengage", category:"universal", difficulty:"easy", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ defSoakDice:"+1d10", tags:{ disengaged:true } },1,"disengage","Disengage")); } },

  /* ===== SWORDS ===== */
  mordhau: { name:"Mordhau Swordsmanship", category:"weapon", weaponType:"sword", difficulty:"hard", cooldown:3, target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ tnDice:"+5d10", dmgDice:"+4d10" },1,"mordhau","Mordhau Swordsmanship")); await setCooldown(actor,"mordhau",3); } },
  riposte: { name:"Riposte", category:"weapon", weaponType:"sword", difficulty:"average", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ defSoakDice:"+1d10", tags:{ riposte:true } },1,"riposte","Riposte")); } },
  closeGaps:{ name:"Close the Gaps!", category:"weapon", weaponType:"sword", difficulty:"easy", target:"self",
    apply: async ({actor}) => { await addMorale(actor,"1d10"); await addEffect(actor, E({ defSoakDice:"+1d10", rangedResistDice:"-1d20" },1,"gaps","Close the Gaps!")); } },

  /* ===== AXES ===== */
  beastRage:{ name:"Beastial Rage", category:"weapon", weaponType:"axe", difficulty:"hard", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ dmgDice:"+3d20" },1,"rage","Beastial Rage")); await addEffect(actor, E({ tnDice:"-1d20", defSoakDice:"-1d20", tags:{ tired:true, disorganized:true } },1,"rage-pen","Spent")); } },
  nimbleAxes:{ name:"Nimble Fighters", category:"weapon", weaponType:"axe", difficulty:"average", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ defSoakDice:"+1d20", tnDice:"-1d20" },1,"nimble","Nimble Fighters")); } },
  heavyHits:{ name:"Heavy Hits", category:"weapon", weaponType:"axe", difficulty:"easy", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ dmgDice:"+1d20", tnDice:"-1d10", defSoakDice:"-1d10" },1,"heavy","Heavy Hits")); } },

  /* ===== POLEARMS ===== */
  schiltron:{ name:"Schiltron", category:"weapon", weaponType:"polearm", difficulty:"hard", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ defSoakDice:"+5d10", tags:{ immuneFlank:true, immuneEncircle:true } },1,"schiltron","Schiltron")); await addMorale(actor,"1d20"); } },
  phalanx:  { name:"Phalanx", category:"weapon", weaponType:"polearm", difficulty:"average", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ defSoakDice:"+3d10", tags:{ antiCharge:true } },1,"phalanx","Phalanx")); } },
  polePrecise:{ name:"Precise Hits", category:"weapon", weaponType:"polearm", difficulty:"easy", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ dmgDice:"+1d10", tags:{ armorIgnorePct:0.25 } },1,"pole-prec","Precise Hits")); await addEffect(actor, E({ defSoakDice:"-1d10" },1,"pole-pen","Exposed")); } },

  /* ===== BOWS ===== */
  bowUncanny:{ name:"Uncanny Shots", category:"weapon", weaponType:"bow", difficulty:"hard", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ tnDice:"+3d10", dmgDice:"+2d10", tags:{ armorIgnorePct:0.25 } },1,"bow-unc","Uncanny Shots")); } },
  bowVolley: { name:"Volley Fire", category:"weapon", weaponType:"bow", difficulty:"average", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ tags:{ multiShot:2, multiShotHalf:true, tired:true } },1,"bow-volley","Volley Fire")); } },
  bowFire:   { name:"Fire Arrows", category:"weapon", weaponType:"bow", difficulty:"easy", target:"enemy",
    apply: async ({actor,target}) => {
      await addEffect(actor, E({ tnDice:"-1d20", dmgDice:"-1d20" },1,"bow-fire-pen","Awkward Fireshot"));
      const mor = await (new Roll("2d20").roll({async:true}));
      const hp  = await (new Roll("1d10").roll({async:true}));
      const cm  = target.getFlag(FLAG_SCOPE,"morale")||0;
      const ch  = target.getFlag(FLAG_SCOPE,"hp")||0;
      await target.setFlag(FLAG_SCOPE,"morale", Math.max(0, cm - mor.total));
      await target.setFlag(FLAG_SCOPE,"hp",     Math.max(0, ch - hp.total));
    } },

  /* ===== CROSSBOWS ===== */
  xbowVolley:{ name:"Volley Fire", category:"weapon", weaponType:"crossbow", difficulty:"hard", cooldown:2, target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ tags:{ multiShot:2, multiShotHalf:true } },1,"xbow-volley","Volley Fire")); await setCooldown(actor,"xbowVolley",2); } },
  xbowTakeDown:{ name:"Take it Down!", category:"weapon", weaponType:"crossbow", difficulty:"average", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ tnDice:"+3d10", dmgDice:"+3d10" },1,"xbow-down","Take it Down!")); } },
  xbowPrecise:{ name:"Precise Hits", category:"weapon", weaponType:"crossbow", difficulty:"easy", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ tnDice:"-3d10", tags:{ pierceArmor:true } },1,"xbow-prec","Precise Hits")); } },

  /* ===== FIREARMS ===== */
  aimShots: { name:"Aim Your Shots!", category:"weapon", weaponType:"firearm", difficulty:"hard", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ tags:{ skipTurn:true, nextRoundBuff:{ tnDice:"+3d10", dmgDice:"+6d10" } } },2,"aim","Aimed Shots")); } },
  contFire: { name:"Continuous Fire", category:"weapon", weaponType:"firearm", difficulty:"average", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ tags:{ continuousFire:true, halfDamage:true } },3,"cont","Continuous Fire")); } },
  reloadFire:{ name:"Reload!", category:"weapon", weaponType:"firearm", difficulty:"easy", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ defSoakDice:"-1d20", tags:{ tired:true } },1,"reload-f","Reload!")); } },

  /* ===== ARTILLERY ===== */
  counterBattery:{ name:"Counter Battery Fire", category:"weapon", weaponType:"artillery", difficulty:"hard", target:"enemy",
    apply: async ({target}) => { const r=await(new Roll("2d20").roll({async:true})); const ch=target.getFlag(FLAG_SCOPE,"hp")||0; await target.setFlag(FLAG_SCOPE,"hp", Math.max(0, ch - r.total)); } },
  entrench:{ name:"Entrench!", category:"weapon", weaponType:"artillery", difficulty:"average", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ rangedResistDice:"+4d10", tags:{ resistChargeBonus:true } },99,"entrench","Entrenched")); } },
  reloadArt:{ name:"Reload!", category:"weapon", weaponType:"artillery", difficulty:"easy", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ tags:{ fastReload:true, tired:true } },1,"reload-a","Reload!")); } },

  /* ===== HYBRID ===== */
  smokeBomb:{ name:"Smoke Bomb", category:"hybrid", difficulty:"average", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ tags:{ coverAura:true } },1,"smoke","Smoke Bomb")); } },
  cripple:  { name:"Cripple", category:"hybrid", difficulty:"hard", target:"enemy",
    apply: async ({target}) => { await subMorale(target,"3d10"); await addEffect(target, E({ defPenaltyDice:"-1d20", tags:{ disorganized:true } },1,"cripple","Crippled")); } },
  ambushSetup:{ name:"Ambush Setup", category:"hybrid", difficulty:"average", target:"enemy",
    apply: async ({actor,target}) => { await addEffect(target, E({ defPenaltyDice:"-1d20", tags:{ flanked:true } },1,"ambushed","Ambushed")); await addEffect(actor, E({ dmgDice:"+3d10" },1,"ambush-buff","Ambush Setup")); } },
  feintRetreat:{ name:"Feint & Retreat", category:"hybrid", difficulty:"average", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ dmgDice:"-1/2", tags:{ disengaged:true } },1,"feint","Feint & Retreat")); } },
  shadowplay:{ name:"Shadowplay", category:"hybrid", difficulty:"hard", target:"self",
    apply: async ({actor}) => { await addEffect(actor, E({ defSoakDice:"+3d10", tags:{ freeMove:true } },1,"shadow","Shadowplay")); } }
};

export function maneuversFor(actor){
  const role = actor.getFlag(FLAG_SCOPE,"role") || "infantry";
  const weapon = actor.getFlag(FLAG_SCOPE,"weapon") || "sword";
  return Object.entries(MANEUVERS).filter(([k,m])=>{
    if (m.category === "universal") return true;
    if (m.category === "weapon")    return m.weaponType === weapon;
    if (m.category === "hybrid")    return role === "hybrid";
    return false;
  }).map(([key,data])=>({ key, ...data }));
}

export async function onManeuverFail(actor){
  const eff = { key:"fail-disorg", label:"Disorganized (Failed Maneuver)", duration:1,
    mods:{ defPenaltyDice:"-1d20", tags:{ disorganized:true } } };
  const list = (actor.getFlag(FLAG_SCOPE,"effects")||[]); list.push(eff);
  await actor.setFlag(FLAG_SCOPE,"effects", list);
}
