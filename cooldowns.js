import { FLAG_SCOPE } from "../config.js";
export function getCooldowns(actor){ return actor.getFlag(FLAG_SCOPE,"cooldowns") || {}; }
export function isOnCooldown(actor, key){ return (getCooldowns(actor)[key] || 0) > 0; }
export async function setCooldown(actor, key, n){
  const cd = getCooldowns(actor); cd[key] = Math.max(0, n);
  await actor.setFlag(FLAG_SCOPE,"cooldowns", cd);
}
export async function tickCooldowns(actor){
  const cd = getCooldowns(actor); let changed = false;
}