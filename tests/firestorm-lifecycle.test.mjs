import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("module targets Foundry VTT 14", async () => {
  const manifest = JSON.parse(await read("module.json"));
  assert.equal(manifest.compatibility.minimum, "14");
  assert.equal(manifest.compatibility.verified, "14");
});

test("Firestorm placement persists every caster identifier", async () => {
  const [maneuvers, aoe, specialists] = await Promise.all([
    read("scripts/logic/maneuvers.js"),
    read("scripts/aoe.js"),
    read("scripts/logic/specialists.js")
  ]);

  for (const [name, source] of Object.entries({ maneuvers, aoe, specialists })) {
    assert.match(source, /casterActorId/, `${name} must preserve the caster actor`);
    assert.match(source, /casterCombatantId/, `${name} must preserve the caster combatant`);
    assert.match(source, /casterTokenId/, `${name} must preserve the caster token`);
  }
});

test("Firestorm lifecycle supports unlinked-token combatants", async () => {
  const zones = await read("scripts/logic/zones.js");

  assert.match(zones, /casterCombatantId:\s*casterCombatantId\s*\?\?\s*createdTurn\?\.combatantId\s*\?\?\s*null/);
  assert.match(zones, /zone\.casterCombatantId\s*&&\s*zone\.casterCombatantId\s*===\s*context\.combatantId/);
  assert.match(zones, /await document\.update\(\{ x: movement\.update\.x, y: movement\.update\.y \}\)/);
  assert.match(zones, /await document\.delete\(\)/);
});
