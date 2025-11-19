import { FLAG_SCOPE } from "../config.js";
import { ensureChaosMutation } from "../passives/chaos.js";
import mutationTable from "../../database/tables/chaos_mutations_d10.json" assert { type: "json" };

/**
 * Apply origin-specific initialization such as rolling Chaos mutations.
 * @param {Actor} actor
 */
export async function applyOrigin(actor) {
  if (!actor) return;
  const origin = actor.getFlag?.(FLAG_SCOPE, "origin")
    ?? foundry.utils.getProperty(actor.system ?? actor.data?.data, "squad.origin");
  if (origin !== "chaos") return;
  await ensureChaosMutation(actor, mutationTable);
}
