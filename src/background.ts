/**
 * background.ts — MV3 Service Worker
 *
 * Responsibilities:
 * 1. Create the Offscreen Document on demand
 * 2. Route CLASSIFY requests from content script → offscreen → back
 * 3. Receive STATUS_UPDATE messages from offscreen and persist to storage
 * 4. Set default settings on install
 */

const OFFSCREEN_URL = "offscreen.html";
let creating: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  if (creating) return creating;

  // Check if one already exists
  // @ts-expect-error chrome.runtime.getContexts is MV3 only
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });

  if (contexts.length > 0) return;

  creating = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    // @ts-expect-error WORKERS is a valid reason but types may lag
    reasons: ["WORKERS"],
    justification: "Run local ONNX model in a Web Worker to detect AI-generated images.",
  });

  await creating;
  creating = null;
}

// ---- Install: set defaults ------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    enabled: true,
    threshold: 0.75,
    blurDetected: false,
    scanCount: 0,
    flaggedCount: 0,
    modelStatus: "idle",
  });
});

// ---- Message router -------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Status updates from offscreen → write to storage
  if (message.type === "STATUS_UPDATE") {
    chrome.storage.local.set({ modelStatus: message.status });
    return false;
  }

  // From content script → forward to offscreen
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
    return true; // keep channel open
  }

  // From content script: warm up the model
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
