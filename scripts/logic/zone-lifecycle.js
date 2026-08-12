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

/** Find the combatant which owns the casting token instead of assuming it is the active turn. */
export function findCasterCombatantId(combat, { tokenId = null, actorId = null } = {}) {
  const combatants = combat?.combatants?.contents ?? combat?.combatants ?? [];
  const entries = Array.from(combatants);
  const tokenMatch = tokenId
    ? entries.find(entry => (entry?.tokenId ?? entry?.token?.id) === tokenId)
    : null;
  if (tokenMatch) return tokenMatch.id ?? tokenMatch._id ?? null;
  const actorMatch = actorId
    ? entries.find(entry => (entry?.actorId ?? entry?.actor?.id) === actorId)
    : null;
  return actorMatch?.id ?? actorMatch?._id ?? null;
}

/** Determine whether a combat turn belongs to a zone's caster. */
export function isZoneCasterTurn(zone = {}, context = {}) {
  return Boolean(
    (zone.casterActorId && zone.casterActorId === context.actorId)
    || (zone.casterCombatantId && zone.casterCombatantId === context.combatantId)
    || (zone.casterTokenId && zone.casterTokenId === context.tokenId)
  );
}
