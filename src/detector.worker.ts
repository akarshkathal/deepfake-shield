/**
 * detector.worker.ts
 *
 * Runs in a Web Worker so inference never blocks the UI thread.
 *
 * Model: onnx-community/Deep-Fake-Detector-v2-Model-ONNX
 * - Architecture: ViT (Vision Transformer), vit-base-patch16-224-in21k fine-tuned
 * - Labels: "Realism" | "Deepfake"
 * - Accuracy: 92.12% on 56k test images
 * - License: Apache-2.0
 *
 * The model is fetched from HuggingFace on first use and cached by
 * transformers.js in the browser's Cache API automatically.
 * Subsequent loads are instant (served from cache).
 */

import { pipeline, env } from "@huggingface/transformers";
import type { ImageClassificationPipeline } from "@huggingface/transformers";

// Disable multi-threading — there's a known bug in onnxruntime-web that breaks
// it inside Chrome extensions. See: github.com/microsoft/onnxruntime/issues/14445
env.backends.onnx.wasm.numThreads = 1;

// Allow remote model fetching from HuggingFace, no local model files
env.allowLocalModels = false;
env.allowRemoteModels = true;

// NOTE: env.backends.onnx.wasm.wasmPaths is set via the LOAD message below
// because chrome.runtime.getURL is NOT available inside Web Workers.

// ---- Types ----------------------------------------------------------------

export type WorkerRequest =
  | { type: "LOAD"; wasmPath: string }
  | { type: "CLASSIFY"; id: string; imageUrl: string };

export type WorkerResponse =
  | { type: "LOAD_PROGRESS"; progress: number; message: string }
  | { type: "LOAD_DONE" }
  | { type: "LOAD_ERROR"; error: string }
  | { type: "RESULT"; id: string; label: "Real" | "Deepfake"; score: number }
  | { type: "CLASSIFY_ERROR"; id: string; error: string };

// ---- Singleton pipeline ---------------------------------------------------

let detector: ImageClassificationPipeline | null = null;

async function loadModel(wasmPath: string): Promise<void> {
  const postMsg = (msg: WorkerResponse) => self.postMessage(msg);

  try {
    // Set wasmPaths from the path passed in by offscreen (which has chrome.* access)
    env.backends.onnx.wasm.wasmPaths = wasmPath;

    postMsg({ type: "LOAD_PROGRESS", progress: 0, message: "Starting model download..." });

    detector = (await pipeline(
      "image-classification",
      "prithivMLmods/Deepfake-Detection-Exp-02-21-ONNX",
      {
        // uint8 quantized = 87MB vs full model 343MB — good tradeoff for extension
        dtype: "uint8",
        progress_callback: (progressInfo: { status: string; progress?: number; file?: string }) => {
          if (progressInfo.status === "downloading" && progressInfo.progress !== undefined) {
            postMsg({
              type: "LOAD_PROGRESS",
              progress: Math.round(progressInfo.progress),
              message: `Downloading model${progressInfo.file ? ` (${progressInfo.file})` : ""}...`,
            });
          } else if (progressInfo.status === "loading") {
            postMsg({ type: "LOAD_PROGRESS", progress: 95, message: "Loading model into memory..." });
          }
        },
      }
    )) as ImageClassificationPipeline;

    postMsg({ type: "LOAD_DONE" });
  } catch (err) {
    postMsg({ type: "LOAD_ERROR", error: String(err) });
  }
}

// ---- Message handler ------------------------------------------------------

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === "LOAD") {
    await loadModel(msg.wasmPath);
    return;
  }

  if (msg.type === "CLASSIFY") {
    if (!detector) {
      self.postMessage({
        type: "CLASSIFY_ERROR",
        id: msg.id,
        error: "Model not loaded yet",
      } satisfies WorkerResponse);
      return;
    }

    try {
      // transformers.js ImageClassificationPipeline accepts a URL string directly.
      // It fetches the image internally and resizes to 224x224 as required by ViT.
      const results = await detector(msg.imageUrl, { topk: 2 });

      // results is an array like:
      // [{ label: "Deepfake", score: 0.87 }, { label: "Realism", score: 0.13 }]
      const top = Array.isArray(results) ? results[0] : (results as { label: string; score: number });

      self.postMessage({
        type: "RESULT",
        id: msg.id,
        label: top.label as "Real" | "Deepfake",
        score: top.score,
      } satisfies WorkerResponse);
    } catch (err) {
      self.postMessage({
        type: "CLASSIFY_ERROR",
        id: msg.id,
        error: String(err),
      } satisfies WorkerResponse);
    }
  }
};
