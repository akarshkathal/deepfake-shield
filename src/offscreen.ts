/**
 * offscreen.ts — v0.2
 *
 * Runs inside an Offscreen Document (extension origin).
 *
 * New in v0.2: runs C2PA detection in PARALLEL with ML inference. C2PA
 * gives us a deterministic answer when present (the image declares itself
 * as AI-generated cryptographically), so we prefer it over the ML score.
 *
 * The offscreen document only has access to a limited set of chrome.* APIs
 * (mainly chrome.runtime). It does NOT have chrome.storage. So all status
 * updates are sent to the background via chrome.runtime.sendMessage and
 * the background updates storage.
 */

import { checkC2PA, type C2PAResult } from "./c2pa";

/** Final result sent back to content.ts. */
export type ClassifyResponse = {
  /** ML model's normalized label. */
  mlLabel: "Realism" | "Deepfake";
  /** Probability of the ML top label, 0-1. */
  mlScore: number;
  /** Probability of "Deepfake" specifically — what content.ts thresholds on. */
  mlDeepfakeScore: number;
  /** C2PA provenance result. hasC2PA=false means no manifest found. */
  c2pa: C2PAResult;
  error?: string;
};

type PendingCallback = (result: ClassifyResponse) => void;

let worker: Worker | null = null;
let modelReady = false;
const pending = new Map<string, {
  callback: PendingCallback;
  c2paPromise: Promise<C2PAResult>;
}>();

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(chrome.runtime.getURL("detector.worker.js"), { type: "module" });

  worker.onmessage = async (event) => {
    const msg = event.data;

    if (msg.type === "LOAD_PROGRESS") {
      chrome.runtime.sendMessage({
        type: "STATUS_UPDATE",
        status: "loading",
        progress: msg.progress,
        message: msg.message,
      }).catch(() => {});
    }

    if (msg.type === "LOAD_DONE") {
      modelReady = true;
      chrome.runtime.sendMessage({ type: "STATUS_UPDATE", status: "ready" }).catch(() => {});
    }

    if (msg.type === "LOAD_ERROR") {
      chrome.runtime.sendMessage({ type: "STATUS_UPDATE", status: "error", error: msg.error }).catch(() => {});
    }

    if (msg.type === "RESULT") {
      const slot = pending.get(msg.id);
      if (slot) {
        // Wait for the C2PA check that was kicked off in parallel.
        const c2pa = await slot.c2paPromise;
        slot.callback({
          mlLabel: msg.label,
          mlScore: msg.score,
          mlDeepfakeScore: msg.deepfakeScore,
          c2pa,
        });
        pending.delete(msg.id);
      }
    }

    if (msg.type === "CLASSIFY_ERROR") {
      const slot = pending.get(msg.id);
      if (slot) {
        const c2pa = await slot.c2paPromise;
        slot.callback({
          mlLabel: "Realism",
          mlScore: 0,
          mlDeepfakeScore: 0,
          c2pa,
          error: msg.error,
        });
        pending.delete(msg.id);
      }
    }
  };

  worker.onerror = (err) => {
    console.error("[Offscreen] Worker crashed:", err);
    chrome.runtime.sendMessage({
      type: "STATUS_UPDATE",
      status: "error",
      error: err.message || "Worker crashed",
    }).catch(() => {});
    worker = null;
    modelReady = false;
  };

  // Pass the extension's URL into the worker so it knows where the WASM files are.
  // Workers don't have chrome.* APIs, so we resolve the URL out here and pass it in.
  worker.postMessage({ type: "LOAD", wasmPath: chrome.runtime.getURL("") });
  return worker;
}

// ---- Listen for classify requests from the service worker -----------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  if (message.type === "CLASSIFY") {
    const w = getWorker();

    if (!modelReady) {
      const wait = setInterval(() => {
        if (modelReady) {
          clearInterval(wait);
          handleClassify(w, message.id, message.imageUrl, sendResponse);
        }
      }, 200);
      return true;
    }

    handleClassify(w, message.id, message.imageUrl, sendResponse);
    return true;
  }

  if (message.type === "INIT") {
    getWorker();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

function handleClassify(
  w: Worker,
  id: string,
  imageUrl: string,
  sendResponse: PendingCallback
) {
  // Kick off C2PA check IN PARALLEL with the ML inference. Both run
  // concurrently; we combine results when the ML side resolves.
  const c2paPromise = checkC2PA(imageUrl);

  pending.set(id, { callback: sendResponse, c2paPromise });
  w.postMessage({ type: "CLASSIFY", id, imageUrl });
}

// Eagerly start the worker on document load
getWorker();
