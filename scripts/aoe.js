import { MODULE_ID } from "./config.js";
import { createZoneState } from "./logic/zones.js";

const DEFAULT_DISTANCE = 4;

function unitsToPixels(units) {
  const size = Number(canvas?.grid?.size ?? canvas?.dimensions?.size ?? 100) || 100;
  const distance = Number(canvas?.dimensions?.distance ?? canvas?.grid?.distance ?? 5) || 5;
  return (Number(units) || 0) * (size / distance);
}

const AOE_DEFINITIONS = {
  firestorm: {
    template: { t: "circle", distance: 4 },
    labelKey: "W4SQ.AoEFirestorm"
  },
  fireball: {
    template: { t: "circle", distance: 3 },
    labelKey: "W4SQ.AoEFireball"
  },
  minefield: {
    template: { t: "circle", distance: 1.5 },
    labelKey: "W4SQ.AoEMinefield"
  },
  wolfPits: {
    template: { t: "circle", distance: 1.5 },
    labelKey: "W4SQ.AoEWolfPits"
  },
  fortify: {
    template: { t: "circle", distance: 3.5 },
    labelKey: "W4SQ.AoEFortify"
  },
  lineDefense: {
    template: { t: "circle", distance: 1.5 },
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
        const message = err?.message
          ? `${game.i18n.localize("W4SQ.ChatAoEPreviewUnavailable")} (${err.message})`
          : game.i18n.localize("W4SQ.ChatAoEPreviewUnavailable");
        ui.notifications?.error?.(message);
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
  const surface = new PIXI.Graphics();
  surface.eventMode = "static";
  surface.cursor = "crosshair";
  surface.zIndex = Number.MAX_SAFE_INTEGER;
  const dimensions = canvas.dimensions;
  const sceneRect = dimensions?.sceneRect ?? dimensions?.rect;
  const surfaceBounds = {
    x: Number(sceneRect?.x ?? 0),
    y: Number(sceneRect?.y ?? 0),
    width: Number(sceneRect?.width ?? dimensions?.width ?? 0),
    height: Number(sceneRect?.height ?? dimensions?.height ?? 0)
  };
  // A nearly transparent Graphics object supplies a real PIXI hit geometry in
  // both the v7-style and v8-style APIs used by Foundry v13 installations.
  if (typeof surface.rect === "function" && typeof surface.fill === "function") {
    surface.rect(surfaceBounds.x, surfaceBounds.y, surfaceBounds.width, surfaceBounds.height)
      .fill({ color: 0x000000, alpha: 0.001 });
  } else {
    surface.beginFill(0x000000, 0.001);
    surface.drawRect(surfaceBounds.x, surfaceBounds.y, surfaceBounds.width, surfaceBounds.height);
    surface.endFill();
  }

  const preview = new PIXI.Graphics();
  if (typeof preview.circle === "function" && typeof preview.fill === "function" && typeof preview.stroke === "function") {
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
  surface.addChild(preview);
  canvas.stage.addChild(surface);

  const move = event => {
    const point = event.getLocalPosition(canvas.stage);
    preview.position.set(point.x, point.y);
  };
  const cleanup = () => {
    surface.off("pointermove", move);
    surface.off("pointerdown", place);
    canvas.app.view.removeEventListener("contextmenu", cancel);
    window.removeEventListener("keydown", keydown);
    surface.destroy({ children: true });
  };
  const place = event => {
    if (event.button === 2) {
      event.preventDefault();
      cleanup();
      return;
    }
    if (event.button !== 0) return;
    const point = event.getLocalPosition(canvas.stage);
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
  surface.on("pointermove", move);
  surface.on("pointerdown", place);
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
    duration,
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

  base.flags = base.flags ?? {};
  base.flags[MODULE_ID] = {
    zone: createZoneState({
      type,
      casterTokenId,
      duration,
      magical: Boolean(data?.magical),
      movementSquares: data?.movePerRound,
      position: { x: base.x, y: base.y },
      template: { type: templateConfig.t ?? "circle", radiusUnits: templateConfig.distance ?? DEFAULT_DISTANCE }
    })
  };
  return base;
}
