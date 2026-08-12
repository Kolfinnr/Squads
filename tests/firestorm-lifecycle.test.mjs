import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("module targets Foundry VTT 14", async () => {
  const manifest = JSON.parse(await read("module.json"));
  assert.equal(manifest.compatibility.minimum, "14");
  assert.equal(manifest.compatibility.verified, "14");
});

test("casting creates the AoE at the triggering token", async () => {
  const source = await read("scripts/aoe.js");
  assert.match(source, /casterTokenId \? canvas\?\.tokens\?\.get\(casterTokenId\)/);
  assert.match(source, /base\.x = center\?\.x \?\? 0/);
  assert.match(source, /base\.y = center\?\.y \?\? 0/);
});

test("the restored AoE engine owns combat-round processing", async () => {
  const source = await read("scripts/aoe.js");
  assert.match(source, /Hooks\.on\("combatRound", handleCombatRound\)/);
  assert.match(source, /await tickAoEZones\(combat, \{ reason: "round" \}\)/);
  assert.match(source, /removed = await handleFirestormTick/);
});

test("Firestorm damages, moves three cells, counts down, and deletes", async () => {
  const source = await read("scripts/aoe.js");
  const start = source.indexOf("async function handleFirestormTick");
  const end = source.indexOf("async function handleFireballTick", start);
  const lifecycle = source.slice(start, end);
  assert.match(lifecycle, /applyDamageToTokens/);
  assert.match(lifecycle, /await moveFirestorm/);
  assert.match(lifecycle, /decrementRemaining\(state\)/);
  assert.match(lifecycle, /await templateDoc\.delete\(\)/);
  assert.match(lifecycle, /movePerRound \?\? 3/);
  assert.match(lifecycle, /await templateDoc\.update\(\{ x: newX, y: newY \}\)/);
});

test("the competing canonical zone runtime is disconnected", async () => {
  const index = await read("scripts/index.js");
  assert.doesNotMatch(index, /tickZonesForActor|handleZoneTemplateCreated|migrateZoneDocuments/);
});
