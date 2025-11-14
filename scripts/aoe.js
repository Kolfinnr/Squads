/**
 * Area-of-Effect placement helpers for squad abilities.
 * This module prefers Foundry's built-in template preview and falls back to a
 * lightweight custom preview when the API is unavailable.
 */

/**
 * Start an AoE placement preview for a squad.
 * @param {Actor} actor - The squad actor responsible for this AoE.
 * @param {Object} [options]
 * @param {"circle"|"cone"|"rect"|"ray"} [options.type="circle"]
 * @param {number} [options.distance=4] - Radius/length in grid units.
 */
export function startSquadAoePreview(actor, options = {}) {
  if (!actor) {
    console.warn("[W4SQ] startSquadAoePreview called without actor");
    return null;
  }
  if (!canvas?.scene) {
    console.warn("[W4SQ] Cannot start AoE preview without an active scene");
    return null;
  }

  const type = options.type ?? "circle";
  const distance = Number(options.distance ?? 4) || 4;
  const templateData = {
    t: type,
    user: game.user.id,
    distance,
    direction: 0,
    x: 0,
    y: 0,
    fillColor: game.user.color,
    flags: {
      "wfrp4e-squads": {
        squadActorId: actor.id
      }
    }
  };

  if (game.measuredTemplate?.createPreview) {
    return game.measuredTemplate.createPreview({
      templateData,
      user: game.user
    });
  }

  const doc = new MeasuredTemplateDocument(templateData, { parent: canvas.scene });
  const preview = new SquadAoeTemplate(doc);
  preview.draw();
  preview.activatePreviewListeners();
  return preview;
}

class SquadAoeTemplate extends MeasuredTemplate {
  async _onLeftClick(event) {
    event.stopPropagation();
    const data = this.document.toObject();
    const created = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [data]);
    const doc = created?.[0];
    this.destroy();
    if (doc) await handleSquadAoe(doc);
  }

  _onRightClick(event) {
    event.stopPropagation();
    this.destroy();
  }
}

/**
 * Handle the AoE after it has been placed on the scene.
 * @param {MeasuredTemplateDocument} templateDoc
 */
async function handleSquadAoe(templateDoc) {
  const squadActorId = templateDoc.getFlag("wfrp4e-squads", "squadActorId");
  if (!squadActorId) return;
  const actor = game.actors.get(squadActorId);
  if (!actor) return;

  console.log("[W4SQ] Squad AoE placed:", {
    actor: actor.name,
    template: templateDoc.toObject()
  });

  // Future extension point: detect tokens within the template and apply
  // squad-specific damage or status effects.
}
