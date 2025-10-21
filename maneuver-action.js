// scripts/features/maneuver-action.js
import { FLAG_SCOPE } from "../config.js";
import { MANEUVERS, maneuversFor, onManeuverFail } from "../logic/maneuvers.js";
import { getCooldowns, isOnCooldown, setCooldown } from "../logic/cooldowns.js";

function clampTN(tn){ return Math.min(125, Math.max(5, tn)); }
async function rollTN(actor, difficulty){
  const exp = Number(actor.getFlag(FLAG_SCOPE,"experienceTier")||0);
  const eq  = Number(actor.getFlag(FLAG_SCOPE,"equipmentTier")||0);
  let tn = 40 + exp*7 + eq*5;
  // situational tweaks
  const morale = Number(actor.getFlag(FLAG_SCOPE,"morale")||0);
  const moraleMax = Number(actor.getFlag(FLAG_SCOPE,"moraleMax")||1);
  if (moraleMax>0 && (morale/moraleMax) < 0.3) tn -= 10;
  if ((actor.getFlag(FLAG_SCOPE,"hp")||0) <= 0) tn -= 20;

  tn += ({ easy:0, average:-10, hard:-20 }[difficulty]||0);
  tn = clampTN(tn);

  const r = await (new Roll("1d100").roll({async:true}));
  return { tn, roll:r.total, ok: r.total <= tn };
}

export async function openManeuverDialog(actor){
  const list = maneuversFor(actor);
  const cds  = getCooldowns(actor);

  // Build list (disabled if on cooldown)
  const options = list.map(m=>{
    const cd = cds[m.key]||0;
    const dis = cd>0 ? "disabled" : "";
    const tag = m.weaponType ? `[${m.weaponType}]` : (m.category==="hybrid"?"[hybrid]": "[universal]");
    return `<option value="${m.key}" ${dis}>${m.name} ${tag} — ${m.difficulty}${cd?` (CD ${cd})`:""}</option>`;
  }).join("");

  new Dialog({
    title: "Choose Maneuver",
    content: `<div class="form-group">
      <label>Maneuver</label>
      <select id="w4sq-maneuver">${options}</select>
      <p class="notes">Maneuvers on cooldown are disabled.</p>
    </div>`,
    buttons: {
      go: { label: "Execute", callback: async html => {
        const key = html[0].querySelector("#w4sq-maneuver").value;
        const m = MANEUVERS[key]; if (!m) return;
        if (isOnCooldown(actor, key)) { ui.notifications?.warn?.("Maneuver is on cooldown."); return; }

        const { tn, roll, ok } = await rollTN(actor, m.difficulty);
        if (!ok){ await onManeuverFail(actor); ui.notifications?.info?.(`Failed (roll ${roll} > TN ${tn}).`); return; }

        // pick target if needed
        const targets = [...game.user.targets];
        const target = (m.target === "enemy" && targets.length === 1) ? targets[0]?.actor : actor;

        await m.apply({ actor, target });
        if (m.cooldown) await setCooldown(actor, key, m.cooldown);
        ui.notifications?.info?.(`${m.name} succeeded!`);
      }}
    },
    default: "go"
  }).render(true);
}
