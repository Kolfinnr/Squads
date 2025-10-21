export function getDerived(squad) {
  const exp = Number(squad.experienceTier || 0);
  const eq  = Number(squad.equipmentTier || 0);
  return {
    attackBonus: Math.floor(exp * 5 + eq * 2),
    damageBonus: Math.floor(exp + Math.floor(eq/2)),
    defenseBonus: Math.floor(exp * 3),
    capacity: 5 + exp * 2
  };
}
