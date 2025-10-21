import { MODULE_ID } from "./config.js";
import { SquadActorSheet } from "./sheets/squad-sheet.js";
Hooks.once("init", function() {
  console.log(`${MODULE_ID} | init v13 (v0.8.0)`);
  const types = ["character","npc","creature"];
  Actors.registerSheet(MODULE_ID, SquadActorSheet, { types, makeDefault: false, label: "Squad Sheet" });
});