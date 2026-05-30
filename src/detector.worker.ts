/**
 * detector.worker.ts — v0.2
 *
 * Runs in a Web Worker so inference never blocks the UI thread.
 *
 * Model: onnx-community/Deep-Fake-Detector-v2-Model-ONNX
 * - Architecture: ViT (Vision Transformer), vit-base-patch16-224-in21k fine-tuned
 * - Labels: "Realism" | "Deepfake"
 * - Accuracy: 92.12% on 56k test images
 * - License: Apache-2.0
 * - Source: https://huggingface.co/onnx-community/Deep-Fake-Detector-v2-Model-ONNX
 *
 * v0.2 change from v0.1:
 * - Swapped prithivMLmods/Deepfake-Detection-Exp-02-21-ONNX (experimental)
 *   → onnx-community/Deep-Fake-Detector-v2-Model-ONNX (mature v2, same family).
 * - Now returns BOTH probabilities so the content script can decide
 *   "uncertain" vs hard label using its own thresholds.
 *
 * Known limitation: this model is trained primarily on face deepfakes
 * (GAN-era artifacts). It will under-detect modern diffusion outputs
 * (Midjourney v6+, FLUX, DALL-E 3). v0.3 plan: train a custom model on
 * the OpenFake / GenImage dataset to cover modern diffusion artifacts.
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

const MODEL_ID = "onnx-community/Deep-Fake-Detector-v2-Model-ONNX";

// ---- Types ----------------------------------------------------------------

export type WorkerRequest =
  | { type: "LOAD"; wasmPath: string }
  | { type: "CLASSIFY"; id: string; imageUrl: string };

export type WorkerResponse =
  | { type: "LOAD_PROGRESS"; progress: number; message: string }
  | { type: "LOAD_DONE" }
  | { type: "LOAD_ERROR"; error: string }
  | {
      type: "RESULT";
      id: string;
      /** Highest-probability label from the model. */
      label: "Realism" | "Deepfake";
      /** Probability of that label, 0-1. */
      score: number;
      /** Probability of "Deepfake" specifically. Useful for thresholding. */
      deepfakeScore: number;
    }
  | { type: "CLASSIFY_ERROR"; id: string; error: string };

// ---- Singleton pipeline ---------------------------------------------------

let detector: ImageClassificationPipeline | null = null;

async function loadModel(wasmPath: string): Promise<void> {
  const postMsg = (msg: WorkerResponse) => self.postMessage(msg);

  try {
    env.backends.onnx.wasm.wasmPaths = wasmPath;

    postMsg({ type: "LOAD_PROGRESS", progress: 0, message: "Starting model download..." });

    detector = (await pipeline("image-classification", MODEL_ID, {
      // uint8 quantized — much smaller (~87MB) with minimal accuracy loss.
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
    })) as ImageClassificationPipeline;

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
      // top_k=2 ensures we get probabilities for BOTH classes, even though
      // there are only two. This lets us compute "uncertainty" properly.
      // (Note: transformers.js v3 renamed `topk` → `top_k`.)
      // We cast the result to a known shape because the library's union
      // return type produces a "too complex" error under strict mode.
      const raw = await detector(msg.imageUrl, { top_k: 2 } as never);
      const arr = (Array.isArray(raw) ? raw : [raw]) as Array<{ label: string; score: number }>;

      const top = arr[0];

      // Find the deepfake-class probability explicitly. Some models return
      // labels with different casing or wording, so do a fuzzy match.
      const deepfakeEntry = arr.find((r) => /deepfake|fake|ai|generated/i.test(r.label));
      const deepfakeScore =
        deepfakeEntry?.score ??
        (top.label.match(/deepfake|fake|ai|generated/i) ? top.score : 1 - top.score);

      // Normalize the label to the two values we expose.
      const normalizedLabel: "Realism" | "Deepfake" =
        /deepfake|fake|ai|generated/i.test(top.label) ? "Deepfake" : "Realism";

      self.postMessage({
        type: "RESULT",
        id: msg.id,
        label: normalizedLabel,
        score: top.score,
        deepfakeScore,
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
