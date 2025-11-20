import { MODULE_ID, FLAG_SCOPE } from "../config.js";

const SOCKET_NAME = `module.${MODULE_ID}`;
const ORIGINAL_FLAG_METHODS = new Map();
const pendingRequests = new Map();
const REQUEST_TIMEOUT_MS = 10000;
let requestCounter = 0;

function wrapDocumentClass(docClass) {
  if (!docClass || ORIGINAL_FLAG_METHODS.has(docClass)) return;
  const proto = docClass.prototype;
  const originals = {
    set: proto.setFlag,
    unset: proto.unsetFlag
  };
  ORIGINAL_FLAG_METHODS.set(docClass, originals);

  proto.setFlag = async function setFlagPatched(scope, key, value, options = {}) {
    if (scope === FLAG_SCOPE && !this.isOwner && !game.user.isGM) {
      await requestGM("setFlag", {
        uuid: this.uuid,
        scope,
        key,
        value,
        options
      });
      return this;
    }
    return originals.set.call(this, scope, key, value, options);
  };

  proto.unsetFlag = async function unsetFlagPatched(scope, key, options = {}) {
    if (scope === FLAG_SCOPE && !this.isOwner && !game.user.isGM) {
      await requestGM("unsetFlag", {
        uuid: this.uuid,
        scope,
        key,
        options
      });
      return this;
    }
    return originals.unset.call(this, scope, key, options);
  };
}

async function executeGMAction(action, payload) {
  const doc = payload?.uuid ? await fromUuid(payload.uuid) : null;
  if (!doc) throw new Error(`Document not found for ${payload?.uuid || "<missing uuid>"}`);
  const originals = ORIGINAL_FLAG_METHODS.get(doc.constructor);
  if (!originals) throw new Error(`Unsupported document class: ${doc.constructor.name}`);

  switch (action) {
    case "setFlag":
      await originals.set.call(doc, payload.scope, payload.key, payload.value, payload.options ?? {});
      return true;
    case "unsetFlag":
      await originals.unset.call(doc, payload.scope, payload.key, payload.options ?? {});
      return true;
    default:
      throw new Error(`Unknown GM action: ${action}`);
  }
}

async function requestGM(action, data) {
  if (game.user.isGM) {
    return executeGMAction(action, data);
  }
  if (!game.socket) {
    throw new Error(`${MODULE_ID} | Socket unavailable for GM request`);
  }
  const gmActive = game.users.some((u) => u.active && u.isGM);
  if (!gmActive) {
    throw new Error(`${MODULE_ID} | No active GM to service request`);
  }

  const requestId = `${game.user.id}-${Date.now()}-${requestCounter++}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`${MODULE_ID} | GM request timed out (${action})`));
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(requestId, { resolve, reject, timeout });

    game.socket.emit(SOCKET_NAME, {
      type: "request",
      requestId,
      action,
      data
    });
  });
}

export function patchFlagOverrides() {
  wrapDocumentClass(CONFIG.Actor?.documentClass);
  wrapDocumentClass(CONFIG.Token?.documentClass);
}

export function registerSocketBridge() {
  if (!game.socket) return;

  game.socket.on(SOCKET_NAME, async (payload) => {
    if (!payload) return;

    if (payload.type === "response") {
      const pending = pendingRequests.get(payload.requestId);
      if (!pending) return;
      pendingRequests.delete(payload.requestId);
      clearTimeout(pending.timeout);
      if (payload.error) {
        pending.reject(new Error(payload.error));
      } else {
        pending.resolve(payload.result);
      }
      return;
    }

    if (payload.type === "request") {
      if (!game.user.isGM) return;
      const { requestId, action, data } = payload;
      let result;
      let error;
      try {
        result = await executeGMAction(action, data);
      } catch (err) {
        error = err?.message || err;
      }
      game.socket.emit(SOCKET_NAME, {
        type: "response",
        requestId,
        result,
        error
      });
    }
  });
}
