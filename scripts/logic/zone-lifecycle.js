/** Build the stable caster identity stored on a zone document. */
export function resolveZoneCaster({
  casterActorId = null,
  casterCombatantId = null,
  casterTokenId = null,
  createdTurn = null,
  casterToken = null
} = {}) {
  return {
    casterActorId: casterActorId ?? casterToken?.actor?.id ?? null,
    casterCombatantId: casterCombatantId ?? createdTurn?.combatantId ?? null,
    casterTokenId: casterTokenId ?? null
  };
}

/** Determine whether a combat turn belongs to a zone's caster. */
export function isZoneCasterTurn(zone = {}, context = {}) {
  return Boolean(
    (zone.casterActorId && zone.casterActorId === context.actorId)
    || (zone.casterCombatantId && zone.casterCombatantId === context.combatantId)
    || (zone.casterTokenId && zone.casterTokenId === context.tokenId)
  );
}
