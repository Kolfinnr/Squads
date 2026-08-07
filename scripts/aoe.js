import { MODULE_ID } from "./config.js";

const DEFAULT_DISTANCE = 4;

const AOE_DEFINITIONS = {
  firestorm: {
    template: { t: "circle", distance: 4 },
    duration: 3,
    roundOnly: true,
    labelKey: "W4SQ.AoEFirestorm"
  },
  fireball: {
    template: { t: "circle", distance: 3 },
    duration: 1,
    roundOnly: true,
    labelKey: "W4SQ.AoEFireball"
  },
  minefield: {
    template: { t: "circle", distance: 1.5 },
    duration: 4,
    triggerOnEntry: true,
    labelKey: "W4SQ.AoEMinefield"
  },
  wolfPits: {
    template: { t: "circle", distance: 1.5 },
    duration: 4,
    triggerOnEntry: true,
    labelKey: "W4SQ.AoEWolfPits"
  },
  fortify: {
    template: { t: "circle", distance: 3.5 },
    duration: null,
    roundOnly: true,
    labelKey: "W4SQ.AoEFortify"
  },
  lineDefense: {
    template: { t: "circle", distance: 1.5 },
    duration: 4,
    roundOnly: true,
    labelKey: "W4SQ.AoELineDefense"
  }
};

let hooksRegistered = false;

export function registerAoEHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  Hooks.on("renderChatMessageHTML", activateAoEChatLink);
  Hooks.on("dropCanvasData", handleAoECanvasDrop);
}

export async function postAoEPlacementChat(actor, opts = {}, messageKey = "W4SQ.ChatAoEReady") {
  const payload = encodeURIComponent(JSON.stringify({
    type: "W4SQAoE",
    options: opts
  }));
  const label = game.i18n.localize(AOE_DEFINITIONS[opts.type]?.labelKey ?? "W4SQ.AoEUnknown");
  const prompt = game.i18n.format(messageKey, { name: actor?.name ?? "" });
  const linkText = game.i18n.format("W4SQ.ChatAoEDragLink", { aoe: label });
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${prompt}</p><p><a class="w4sq-aoe-drag" draggable="true" data-aoe-payload="${payload}"><i class="fas fa-bullseye"></i> ${linkText}</a></p>`
  });
}

function activateAoEChatLink(_message, html) {
  const root = html?.[0] ?? html;
  const links = [
    ...(root?.matches?.(".w4sq-aoe-drag") ? [root] : []),
    ...(root?.querySelectorAll?.(".w4sq-aoe-drag") ?? [])
  ];
  for (const link of links) {
    if (link.dataset.aoeDragReady === "true") continue;
    link.dataset.aoeDragReady = "true";
    link.addEventListener("dragstart", event => {
      const raw = link.dataset.aoePayload;
      if (!raw) return;
      const json = decodeURIComponent(raw);
      event.dataTransfer?.setData("text/plain", json);
      event.dataTransfer?.setData("application/json", json);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    });
    link.addEventListener("click", async event => {
      event.preventDefault();
      const raw = link.dataset.aoePayload;
      if (!raw) return;
      try {
        const payload = JSON.parse(decodeURIComponent(raw));
        await previewAoEPlacement(payload.options);
      } catch (err) {
        console.error("[W4SQ] Failed to preview AoE placement", err);
        ui.notifications?.error?.(game.i18n.localize("W4SQ.ChatAoEPreviewUnavailable"));
      }
    });
  }
}

async function previewAoEPlacement(opts = {}) {
  const scene = opts.sceneId ? game.scenes.get(opts.sceneId) : canvas.scene;
  if (!scene || scene.id !== canvas.scene?.id) {
    ui.notifications?.warn?.(game.i18n.localize("W4SQ.ChatAoEWrongScene"));
    return;
  }
  const definition = AOE_DEFINITIONS[opts.type];
  if (!definition) return;
  const radius = unitsToPixels(definition.template.distance ?? DEFAULT_DISTANCE);
  const preview = new PIXI.Graphics();
  if (typeof preview.circle === "function") {
    preview.circle(0, 0, radius)
      .fill({ color: 0xff3300, alpha: 0.2 })
      .stroke({ color: 0xff6600, width: 3, alpha: 0.95 });
  } else {
    preview.lineStyle(3, 0xff6600, 0.95);
    preview.beginFill(0xff3300, 0.2);
    preview.drawCircle(0, 0, radius);
    preview.endFill();
  }
  preview.eventMode = "none";
  canvas.stage.addChild(preview);

  const eventPoint = event => {
    const rect = canvas.app.view.getBoundingClientRect();
    const rendererPoint = new PIXI.Point(
      (event.clientX - rect.left) * (canvas.app.renderer.width / rect.width),
      (event.clientY - rect.top) * (canvas.app.renderer.height / rect.height)
    );
    return canvas.stage.worldTransform.applyInverse(rendererPoint);
  };
  const move = event => {
    const point = eventPoint(event);
    preview.position.set(point.x, point.y);
  };
  const cleanup = () => {
    canvas.app.view.removeEventListener("pointermove", move, true);
    canvas.app.view.removeEventListener("pointerdown", place, true);
    canvas.app.view.removeEventListener("contextmenu", cancel);
    window.removeEventListener("keydown", keydown);
    preview.destroy();
  };
  const place = event => {
    if (event.button !== 0) return;
    // Listen on the canvas element in the capture phase. Tokens consume PIXI
    // pointer events, which previously made it impossible to place an area over
    // an occupied space.
    event.preventDefault();
    event.stopPropagation();
    const point = eventPoint(event);
    cleanup();
    createAoEFromEffect({ ...opts, sceneId: scene.id, position: { x: point.x, y: point.y } });
  };
  const cancel = event => {
    event.preventDefault();
    cleanup();
  };
  const keydown = event => {
    if (event.key === "Escape") cleanup();
  };
  canvas.app.view.addEventListener("pointermove", move, true);
  canvas.app.view.addEventListener("pointerdown", place, true);
  canvas.app.view.addEventListener("contextmenu", cancel, { once: true });
  window.addEventListener("keydown", keydown);
}

async function handleAoECanvasDrop(_canvas, data) {
  if (data?.type !== "W4SQAoE" || !data.options) return;
  const sceneId = canvas?.scene?.id;
  if (data.options.sceneId && data.options.sceneId !== sceneId) {
    ui.notifications?.warn?.(game.i18n.localize("W4SQ.ChatAoEWrongScene"));
    return false;
  }
  await createAoEFromEffect({
    ...data.options,
    sceneId,
    position: { x: Number(data.x) || 0, y: Number(data.y) || 0 }
  });
  return false;
}

export async function createAoEFromEffect(opts = {}) {
  const {
    sceneId = canvas?.scene?.id,
    userId = game.user.id,
    casterTokenId = null,
    type = "firestorm",
    duration,
    data = {},
    position = null
  } = opts;

  const definition = AOE_DEFINITIONS[type];
  if (!definition) {
    console.warn(`[W4SQ] Unknown AoE type: ${type}`);
    return null;
  }

  const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
  if (!scene) {
    console.warn("[W4SQ] Cannot create AoE without scene");
    return null;
  }

  const templateData = buildTemplateData(definition.template, {
    casterTokenId,
    type,
    duration: duration ?? definition.duration,
    data,
    userId,
    sceneId,
    position
  });
  templateData.flags ??= {};
  templateData.flags[MODULE_ID] ??= {};
  try {
    const created = await scene.createEmbeddedDocuments("MeasuredTemplate", [templateData]);
    return created?.[0] ?? null;
  } catch (err) {
    console.error("[W4SQ] Failed to create AoE template", err);
    return null;
  }
}

function buildTemplateData(templateConfig = {}, { casterTokenId, type, duration, data, userId, sceneId, position } = {}) {
  const base = {
    t: templateConfig.t ?? "circle",
    user: userId,
    distance: templateConfig.distance ?? DEFAULT_DISTANCE,
    direction: 0,
    fillColor: game.user?.color ?? "#ff0000"
  };

  if (templateConfig.t === "rect") {
    base.distance = templateConfig.distance ?? 4;
    base.width = templateConfig.width ?? base.distance;
  }

  if (position) {
    base.x = position.x ?? 0;
    base.y = position.y ?? 0;
  } else {
    const caster = casterTokenId ? canvas?.tokens?.get(casterTokenId) : null;
    const center = caster?.center ?? caster?.document?.center ?? null;
    base.x = center?.x ?? 0;
    base.y = center?.y ?? 0;
  }

  const combat = game.combat;
  const placedRound = combat ? Number(combat.round ?? 0) : null;

  const casterToken = casterTokenId ? canvas?.tokens?.get(casterTokenId) : null;
  const zoneKey = type === "fortify" ? "fortifyPosition" : type;
  base.flags = base.flags ?? {};
  base.flags[MODULE_ID] = {
    zone: {
      type: zoneKey,
      casterActorId: casterToken?.actor?.id ?? null,
      casterTokenId,
      disposition: casterToken?.document?.disposition ?? null,
      target: ["minefield", "wolfPits"].includes(type) ? "enemies" : (["fortify", "lineDefense"].includes(type) ? "allies" : "any"),
      magical: Boolean(data?.magical),
      createdRound: placedRound,
      remainingRounds: duration ?? null,
      lastAdvancedRound: placedRound,
      movement: {
        squares: Number(data?.movePerRound ?? 0) || 0,
        direction: null
      },
      template: { type: templateConfig.t ?? "circle", radiusUnits: templateConfig.distance ?? DEFAULT_DISTANCE },
      occupants: [],
      actorTurnTriggers: {},
      triggered: false
    }
  };
  return base;
}
