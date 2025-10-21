import { ACTOR_TYPE } from "../config.js";
import { seedSquadData } from "../domain/squad-model.js";

export function registerCreationSeed() {
  Hooks.on("preCreateActor", (doc, data, options, userId) => {
    if (data.type !== ACTOR_TYPE) return;
    const seed = {
      name: data.name ?? "New Squad",
      type: ACTOR_TYPE,
      system: { squad: seedSquadData() }
    };
    foundry.utils.mergeObject(data, seed, { inplace: true, insertKeys: true, overwrite: false });
  });
}
