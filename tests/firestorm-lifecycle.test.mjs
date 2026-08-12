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

test("AoEs use Foundry 14 Regions instead of deprecated measured templates", async () => {
  const source = await readFile(new URL("../scripts/aoe.js", import.meta.url), "utf8");
  assert.match(source, /createEmbeddedDocuments\("Region", \[regionData\]\)/);
  assert.match(source, /shapes: \[\{ type: "circle", x: center\.x, y: center\.y, radius \}\]/);
  assert.doesNotMatch(source, /MeasuredTemplate/);
});

test("zone runtime uses Region collections and hooks", async () => {
  const [zones, index] = await Promise.all([
    readFile(new URL("../scripts/logic/zones.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/index.js", import.meta.url), "utf8")
  ]);
  assert.match(zones, /scene\?\.regions/);
  assert.doesNotMatch(zones, /scene\?\.templates|canvas\.scene\.templates|canvas\?\.templates/);
  assert.match(index, /Hooks\.on\("createRegion"/);
  assert.match(index, /Hooks\.on\("updateRegion"/);
  assert.match(index, /Hooks\.on\("deleteRegion"/);
  assert.doesNotMatch(index, /MeasuredTemplate/);
});

test("Firestorm does not mutate synthetic actors merely to track occupancy", async () => {
  const source = await readFile(new URL("../scripts/logic/zones.js", import.meta.url), "utf8");
  const firestorm = source.slice(source.indexOf("  firestorm: {"), source.indexOf("  lineDefense: {"));
  assert.doesNotMatch(firestorm, /ensureEffect|addEffect|setFlag/);
  assert.match(firestorm, /async onTurn/);
});

test("turn ticking suppresses no-op synthetic actor updates", async () => {
  const source = await readFile(new URL("../scripts/logic/effects.js", import.meta.url), "utf8");
  const tick = source.slice(source.indexOf("export async function tickEffects"), source.indexOf("export async function tickEffects", source.indexOf("export async function tickEffects") + 1) === -1 ? undefined : source.indexOf("export async function tickEffects", source.indexOf("export async function tickEffects") + 1));
  assert.match(tick, /if \(changed\) await actor\.setFlag/);
  assert.doesNotMatch(tick, /\n\s*await actor\.setFlag\(FLAG_SCOPE, "effects", next\);/);
});

test("clearing channelled magic batches synthetic actor state", async () => {
  const source = await readFile(new URL("../scripts/logic/specialists.js", import.meta.url), "utf8");
  const start = source.indexOf("export async function clearChannelledMagic");
  const end = source.indexOf("\n}\n", start) + 2;
  const clear = source.slice(start, end);
  assert.match(clear, /if \(Object\.keys\(changes\)\.length\) await actor\.update\(changes\)/);
  assert.doesNotMatch(clear, /actor\.setFlag/);
});

test("Firestorm records the active combatant token when the caster has several tokens", async () => {
  const source = await readFile(new URL("../scripts/logic/maneuvers.js", import.meta.url), "utf8");
  const start = source.indexOf("  firestorm: {");
  const end = source.indexOf("  fireball: {", start);
  const firestorm = source.slice(start, end);
  assert.match(firestorm, /activeCombatant\.tokenId/);
  assert.match(firestorm, /canvas\?\.tokens\?\.get\(combatTokenId\)/);
});
