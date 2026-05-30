/**
 * background.ts — MV3 Service Worker
 *
 * Responsibilities:
 * 1. Create the Offscreen Document on demand
 * 2. Route CLASSIFY requests from content script → offscreen → back
 * 3. Receive STATUS_UPDATE messages from offscreen and persist to storage
 * 4. Set default settings on install
 *
 * v0.2 change: the message we relay now carries C2PA info and split scores,
 * but background itself is transport-only — it doesn't care about the shape.
 */

const OFFSCREEN_URL = "offscreen.html";
let offscreenPromise: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  // If we're already creating (or have created) the offscreen doc,
  // all concurrent callers wait on the same promise. This prevents the
  // race condition where multiple parallel CLASSIFY messages each try
  // to call chrome.offscreen.createDocument(), which fails with
  // "Only a single offscreen document may be created."
  if (offscreenPromise) return offscreenPromise;

  offscreenPromise = (async () => {
    // @ts-expect-error chrome.runtime.getContexts is MV3 only
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
    });

    if (contexts.length > 0) return;

    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      // @ts-expect-error WORKERS is a valid reason but types may lag
      reasons: ["WORKERS"],
      justification: "Run local ONNX model in a Web Worker to detect AI-generated images.",
    });
  })();

  try {
    await offscreenPromise;
  } catch (err) {
    // Reset on failure so a subsequent call can retry. If we leave the
    // rejected promise cached, every future request fails forever.
    offscreenPromise = null;
    throw err;
  }
}

// ---- Install: set defaults ------------------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  // On first install: set all defaults.
  if (details.reason === "install") {
    chrome.storage.local.set({
      enabled: true,
      threshold: 0.75,
      blurDetected: false,
      scanCount: 0,
      flaggedCount: 0,
      modelStatus: "idle",
    });
    return;
  }

  // On update: only set keys that don't exist yet so we don't wipe user prefs.
  if (details.reason === "update") {
    chrome.storage.local.get(null, (existing) => {
      const defaults: Record<string, unknown> = {
        enabled: true,
        threshold: 0.75,
        blurDetected: false,
        scanCount: 0,
        flaggedCount: 0,
        modelStatus: "idle",
      };
      const toSet: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(defaults)) {
        if (!(k in existing)) toSet[k] = v;
      }
      if (Object.keys(toSet).length > 0) {
        chrome.storage.local.set(toSet);
      }
    });
  }
});

// ---- Message router -------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "STATUS_UPDATE") {
    chrome.storage.local.set({ modelStatus: message.status });
    return false;
  }

  if (message.type === "CLASSIFY" && !message.target) {
    (async () => {
      try {
        await ensureOffscreenDocument();
        const result = await chrome.runtime.sendMessage({
          ...message,
          target: "offscreen",
        });
        sendResponse(result);
      } catch (err) {
        console.error("[Background] Classify failed:", err);
        sendResponse({ error: String(err) });
      }
    })();
    return true;
  }

  if (message.type === "INIT_MODEL") {
    (async () => {
      try {
        await ensureOffscreenDocument();
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }

  return false;
});