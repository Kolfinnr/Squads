import { MODULE_ID } from "../config.js";

export async function sendActionMessage({ actor, label, tn, rollTotal, success, margin, dmg, moraleLoss, soakDetail, hobNotes = [], backline = false, footer }) {
  let formattedSoak = soakDetail;
  if (typeof formattedSoak === "string") {
    formattedSoak = formattedSoak.replace(/<br\s*\/?>(\s*)/gi, " • $1");
    formattedSoak = formattedSoak.replace(/\s*•\s*•\s*/g, " • ");
    formattedSoak = formattedSoak.trim();
  }
  const content = await renderTemplate(`modules/${MODULE_ID}/templates/chat-action.hbs`, {
    label,
    actorName: actor.name,
    tn,
    roll: rollTotal,
    success,
    margin,
    dmg,
    moraleLoss,
    soakDetail: formattedSoak,
    backline,
    hobNotes,
    footer
  });
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });
}

export async function postNotification(actor, title, body) {
  const content = `<h3>${title}</h3><p>${body}</p>`;
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });
}
