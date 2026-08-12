import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { findCasterCombatantId, isZoneCasterTurn, resolveZoneCaster } from "../scripts/logic/zone-lifecycle.js";

test("module targets Foundry VTT 14", async () => {
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url), "utf8"));
  assert.equal(manifest.compatibility.minimum, "14");
  assert.equal(manifest.compatibility.verified, "14");
});

test("zone caster identity uses explicit placement metadata", () => {
  assert.deepEqual(resolveZoneCaster({
    casterActorId: "actor",
    casterCombatantId: "combatant",
    casterTokenId: "token",
    createdTurn: { combatantId: "creation-combatant" },
    casterToken: { actor: { id: "token-actor" } }
  }), {
    casterActorId: "actor",
    casterCombatantId: "combatant",
    casterTokenId: "token"
  });
});

test("legacy zone identity is recovered from its creation turn and token", () => {
  assert.deepEqual(resolveZoneCaster({
    casterTokenId: "token",
    createdTurn: { combatantId: "creation-combatant" },
    casterToken: { actor: { id: "token-actor" } }
  }), {
    casterActorId: "token-actor",
    casterCombatantId: "creation-combatant",
    casterTokenId: "token"
  });
});

test("caster turn matching supports stable and synthetic identities", () => {
  const zone = {
    casterActorId: "original-actor",
    casterCombatantId: "combatant",
    casterTokenId: "token"
  };

  assert.equal(isZoneCasterTurn(zone, { actorId: "original-actor" }), true);
  assert.equal(isZoneCasterTurn(zone, { actorId: "new-synthetic-actor", combatantId: "combatant" }), true);
  assert.equal(isZoneCasterTurn(zone, { actorId: "new-synthetic-actor", tokenId: "token" }), true);
  assert.equal(isZoneCasterTurn(zone, {
    actorId: "different-actor",
    combatantId: "different-combatant",
    tokenId: "different-token"
  }), false);
});

test("caster combatant is resolved from the casting token, not the active turn", () => {
  const combat = { combatants: { contents: [
    { id: "active-enemy", tokenId: "enemy-token", actorId: "enemy" },
    { id: "casting-mage", tokenId: "mage-token", actorId: "mage" }
  ] } };
  assert.equal(findCasterCombatantId(combat, {
    tokenId: "mage-token",
    actorId: "synthetic-mage"
  }), "casting-mage");
});

test("AoE templates use the Foundry 14 measured-template schema", async () => {
  const source = await readFile(new URL("../scripts/aoe.js", import.meta.url), "utf8");
  assert.match(source, /const base = \{\s*type:/);
  assert.match(source, /author: userId/);
  assert.doesNotMatch(source, /\btemplate:\s*\{\s*t:/);
  assert.doesNotMatch(source, /const base = \{\s*t:/);
});

test("Firestorm does not mutate synthetic actors merely to track occupancy", async () => {
  const source = await readFile(new URL("../scripts/logic/zones.js", import.meta.url), "utf8");
  const firestorm = source.slice(source.indexOf("  firestorm: {"), source.indexOf("  lineDefense: {"));
  assert.doesNotMatch(firestorm, /ensureEffect|addEffect|setFlag/);
  assert.match(firestorm, /async onTurn/);
});
