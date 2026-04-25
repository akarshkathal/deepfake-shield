/**
 * offscreen.ts — runs inside an Offscreen Document (extension origin)
 *
 * The offscreen document only has access to a limited set of chrome.* APIs
 * (mainly chrome.runtime). It does NOT have chrome.storage. So all status
 * updates are sent to the background via chrome.runtime.sendMessage and
 * the background updates storage.
 */

let worker: Worker | null = null;
let modelReady = false;
const pending = new Map<string, (result: { label: string; score: number; error?: string }) => void>();

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(chrome.runtime.getURL("detector.worker.js"), { type: "module" });

  worker.onmessage = (event) => {
    const msg = event.data;

    if (msg.type === "LOAD_PROGRESS") {
      // Forward to background, which will update storage
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
      const cb = pending.get(msg.id);
      if (cb) {
        cb({ label: msg.label, score: msg.score });
        pending.delete(msg.id);
      }
    }

    if (msg.type === "CLASSIFY_ERROR") {
      const cb = pending.get(msg.id);
      if (cb) {
        cb({ label: "Realism", score: 0, error: msg.error });
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
  // Only handle messages targeted at offscreen
  if (message.target !== "offscreen") return false;

  if (message.type === "CLASSIFY") {
    const w = getWorker();

    if (!modelReady) {
      // Wait for model to load before processing
      const wait = setInterval(() => {
        if (modelReady) {
          clearInterval(wait);
          handleClassify(w, message.id, message.imageUrl, sendResponse);
        }
      }, 200);
      return true; // keep channel open
    }

    handleClassify(w, message.id, message.imageUrl, sendResponse);
    return true;
  }

  if (message.type === "INIT") {
    getWorker(); // start loading model
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

function handleClassify(
  w: Worker,
  id: string,
  imageUrl: string,
  sendResponse: (result: { label: string; score: number; error?: string }) => void
) {
  pending.set(id, sendResponse);
  w.postMessage({ type: "CLASSIFY", id, imageUrl });
}

// Eagerly start the worker on document load
getWorker();
