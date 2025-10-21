export async function sendActionMessage({ actor, label, tn, rollTotal, success, margin, dmg, moraleLoss, soakDetail, footer }) {
  const content = `<div class="w4sq-chat">
    <h3>${label} — ${actor.name}</h3>
    <p><b>TN:</b> ${tn}% | <b>Roll:</b> ${rollTotal} | <b>${success ? "Success" : "Failure"}</b>${success ? ` (margin +${margin})` : ""}</p>
    ${success && (dmg != null) ? `<p><b>Damage:</b> ${dmg}${moraleLoss!=null?` &nbsp; | &nbsp; <b>Morale Loss:</b> ${moraleLoss}`:""}</p>` : ""}
    ${soakDetail ? `<p><small>${soakDetail}</small></p>` : ""}
    ${footer ? `<hr><p><small>${footer}</small></p>` : ""}`;
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
}
export async function sendFlavor({ actor, title, text }){
  const content = `<div class="w4sq-chat"><h3>${title} — ${actor.name}</h3><p>${text}</p></div>`;
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
}