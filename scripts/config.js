export const MODULE_ID = "wfrp4e-squads";
export const FLAG_SCOPE = MODULE_ID;
export const ACTOR_TYPES = ["character", "npc", "creature"];
export const SHEET_TEMPLATE = `modules/${MODULE_ID}/templates/squad-sheet.hbs`;

export const DEFAULT_FLAGS = {
  hp: 100,
  hpMax: 100,
  morale: 50,
  moraleMax: 100,
  experienceTier: 0,
  equipmentTier: 0,
  role: "infantry",
  weapon: "sword",
  notes: "",
  fear: false,
  terror: false,
  unbreakable: false,
  playerControlled: null,
  isCommander: false,
  effects: [],
  cooldowns: {},
  cp: { current: 3, cap: 6 },
  standingOrder: "",
  hob_hp30: false,
  hob_mo30: false,
  lastTargetName: ""
};

export const ROLL = { baseTN: 40, minTN: 5, maxTN: 125 };
export const SCALING = { hpFloor: 0.20 };

export const WEAPONS = {
  sword:     { label: "Sword",     accuracyDice: "0",   dmgDice: "+1d10", pierceArmor: false },
  axe:       { label: "Axe",       accuracyDice: "0",   dmgDice: "0",     pierceArmor: true  },
  polearm:   { label: "Polearm",   accuracyDice: "0",   dmgDice: "0",     pierceArmor: false },
  bow:       { label: "Bow",       accuracyDice: "0",   dmgDice: "0",     pierceArmor: false },
  crossbow:  { label: "Crossbow",  accuracyDice: "0",   dmgDice: "0",     pierceArmor: false },
  firearm:   { label: "Firearm",   accuracyDice: "0",   dmgDice: "+1d20", pierceArmor: true  },
  artillery: { label: "Artillery", accuracyDice: "0",   dmgDice: "+2d20", pierceArmor: true  },
  lance:     { label: "Lance",     accuracyDice: "0",   dmgDice: "0",     pierceArmor: false }
};

export const ROLES = {
  infantry: { label: "Infantry", hybridPenalty: false },
  ranged:   { label: "Ranged",   hybridPenalty: false },
  mounted:  { label: "Mounted",  hybridPenalty: false },
  hybrid:   { label: "Hybrid",   hybridPenalty: true }
};

export const SETTINGS = {
  enableHoB: "enableHoB"
};
