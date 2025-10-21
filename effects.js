import { FLAG_SCOPE } from "../config.js";
export function getEffects(actor){ return actor.getFlag(FLAG_SCOPE, "effects") ?? []; }
export async function addEffect(actor, effect){ const list = getEffects(actor); list.push(effect); await actor.setFlag(FLAG_SCOPE, "effects", list); }
export async function removeEffectByKey(actor, key){ const list = getEffects(actor).filter(e => e.key !== key); await actor.setFlag(FLAG_SCOPE, "effects", list); }
export async function clearNegative(actor){
  const list = getEffects(actor).filter(e => { const t = e?.mods?.tags || {}; if (t.flanked || t.encircled || t.panic || t.disorganized) return false; return true; });
  await actor.setFlag(FLAG_SCOPE, "effects", list);
}
export async function tickEffects(actor){
  const list = getEffects(actor).map(e => ({...e, duration: Math.max(0, (e.duration ?? 1) - 1)})).filter(e => (e.duration ?? 0) > 0);
  await actor.setFlag(FLAG_SCOPE, "effects", list);
}
export function aggregateForAttack(actor, context){
  const eff = getEffects(actor);
  let tnDice = "0"; let dmgDice = "0"; const tags = {};
  for (const e of eff){
    const m = e.mods || {};
    if (m.tnDice) tnDice = tnDice + (m.tnDice.startsWith("-")? ` ${m.tnDice}` : ` + ${m.tnDice}`);
    if (m.dmgDice) dmgDice = dmgDice + (m.dmgDice.startsWith("-")? ` ${m.dmgDice}` : ` + ${m.dmgDice}`);
    Object.assign(tags, m.tags || {});
  }
  return { tnDice: tnDice.trim() || "0", dmgDice: dmgDice.trim() || "0", tags };
}
export function aggregateForDefense(actor, context){
  let defSoakDice = "0"; let defPenaltyDice = "0"; let rangedResistDice = "0";
  const tags = {};
  for (const e of getEffects(actor)){
    const m = e.mods || {};
    if (m.defSoakDice) defSoakDice = defSoakDice + (m.defSoakDice.startsWith("-")? ` ${m.defSoakDice}` : ` + ${m.defSoakDice}`);
    if (m.defPenaltyDice) defPenaltyDice = defPenaltyDice + (m.defPenaltyDice.startsWith("-")? ` ${m.defPenaltyDice}` : ` + ${m.defPenaltyDice}`);
    if (m.rangedResistDice) rangedResistDice = rangedResistDice + (m.rangedResistDice.startsWith("-")? ` ${m.rangedResistDice}` : ` + ${m.rangedResistDice}`);
    Object.assign(tags, m.tags || {});
  }
  return { defSoakDice: defSoakDice.trim() || "0", defPenaltyDice: defPenaltyDice.trim() || "0", rangedResistDice: rangedResistDice.trim() || "0", tags };
}