/**
 * content.ts — v0.2
 *
 * Injected into https://www.instagram.com/*
 *
 * Sends image URLs to the background service worker, which routes them
 * to the offscreen document where the Web Worker runs the ML model AND
 * a C2PA provenance check in parallel.
 *
 * v0.2 changes from v0.1:
 *  - Three-state badge: "verified" (C2PA-deterministic), "ai" (ML high
 *    confidence), "uncertain" (ML in the gray zone), "authentic"
 *    (ML high confidence other way).
 *  - C2PA result, when present, OVERRIDES the ML score.
 *  - Confidence percentage always shown — show our work, don't pretend.
 *  - Uncertain band (configurable) avoids confidently-wrong labels.
 */

const scanned = new Set<string>();
let enabled = true;
let threshold = 0.75;
let blurDetected = false;

/** Width of the "uncertain" band on either side of `threshold`.
 *  Example: threshold=0.75, band=0.10 → uncertain from 0.65 to 0.85.
 *  Anything below 0.65 → "authentic", above 0.85 → "ai".
 *  This is intentionally NOT user-facing in v0.2 — too many knobs hurts UX.
 */
const UNCERTAIN_HALF_WIDTH = 0.10;

// ---- Settings -------------------------------------------------------------

chrome.storage.local.get(["enabled", "threshold", "blurDetected"], (result) => {
  enabled = result.enabled ?? true;
  threshold = result.threshold ?? 0.75;
  blurDetected = result.blurDetected ?? false;

  if (enabled) {
    chrome.runtime.sendMessage({ type: "INIT_MODEL" }).catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) enabled = changes.enabled.newValue;
  if (changes.threshold) threshold = changes.threshold.newValue;
  if (changes.blurDetected) blurDetected = changes.blurDetected.newValue;
});

// ---- Observers ------------------------------------------------------------

const intersectionObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target as HTMLImageElement;
      intersectionObserver.unobserve(img);
      processImage(img);
    }
  },
  { rootMargin: "200px", threshold: 0.1 }
);

const mutationObserver = new MutationObserver((mutations) => {
  if (!enabled) return;
  for (const mutation of mutations) {
    for (const node of Array.from(mutation.addedNodes)) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;
      if (el.tagName === "IMG") queueImage(el as HTMLImageElement);
      el.querySelectorAll("img").forEach((img) => queueImage(img));
    }
  }
});

mutationObserver.observe(document.body, { childList: true, subtree: true });
document.querySelectorAll("img").forEach((img) => queueImage(img));

// ---- Queue ----------------------------------------------------------------

function queueImage(img: HTMLImageElement): void {
  if (img.width > 0 && img.width < 100) return;
  if (img.height > 0 && img.height < 100) return;
  if (!img.src || scanned.has(img.src)) return;
  if (!img.src.includes("cdninstagram.com") && !img.src.includes("fbcdn.net")) return;

  scanned.add(img.src);
  intersectionObserver.observe(img);
}

// ---- Classification response shape (mirrors offscreen.ts) -----------------

type C2PAResult = {
  hasC2PA: boolean;
  generator?: string;
  isAIGenerated?: boolean;
};

type ClassifyResponse = {
  mlLabel: "Realism" | "Deepfake";
  mlScore: number;
  mlDeepfakeScore: number;
  c2pa: C2PAResult;
  error?: string;
};

function processImage(img: HTMLImageElement): void {
  if (!enabled) return;

  const id = Math.random().toString(36).slice(2);
  applyBadge(img, { state: "scanning", confidence: 0 });

  chrome.runtime.sendMessage(
    { type: "CLASSIFY", id, imageUrl: img.src },
    (response: ClassifyResponse | { error: string } | undefined) => {
      if (chrome.runtime.lastError) {
        console.warn("[DeepFake Shield]", chrome.runtime.lastError.message);
        removeBadge(img);
        return;
      }
      if (!response || "error" in response && !("mlLabel" in response)) {
        removeBadge(img);
        return;
      }
      handleResult(img, response as ClassifyResponse);
    }
  );
}

function handleResult(img: HTMLImageElement, res: ClassifyResponse): void {
  const decision = decide(res);

  chrome.storage.local.get(["scanCount", "flaggedCount"], (data) => {
    const scanCount = (data.scanCount ?? 0) + 1;
    const flaggedCount =
      (data.flaggedCount ?? 0) + (decision.state === "ai" || decision.state === "verified-ai" ? 1 : 0);
    chrome.storage.local.set({ scanCount, flaggedCount });
  });

  applyBadge(img, decision);

  const shouldBlur =
    blurDetected && (decision.state === "ai" || decision.state === "verified-ai");
  if (shouldBlur) {
    img.style.filter = "blur(12px)";
    img.style.transition = "filter 0.3s ease";
  }
}

/**
 * Combine C2PA + ML results into a single badge decision.
 * C2PA wins when present because it's deterministic — the image itself
 * declared its provenance. ML is only used as a fallback signal.
 */
type Decision =
  | { state: "scanning"; confidence: 0 }
  | { state: "verified-ai"; confidence: number; reason: string }
  | { state: "verified-authentic"; confidence: number; reason: string }
  | { state: "ai"; confidence: number }
  | { state: "uncertain"; confidence: number }
  | { state: "authentic"; confidence: number };

function decide(res: ClassifyResponse): Decision {
  // C2PA path — deterministic.
  if (res.c2pa.hasC2PA) {
    if (res.c2pa.isAIGenerated === true) {
      return {
        state: "verified-ai",
        confidence: 1,
        reason: res.c2pa.generator
          ? `Content Credentials: ${res.c2pa.generator}`
          : "Content Credentials present (AI-generated)",
      };
    }
    if (res.c2pa.isAIGenerated === false) {
      return {
        state: "verified-authentic",
        confidence: 1,
        reason: res.c2pa.generator
          ? `Content Credentials: ${res.c2pa.generator}`
          : "Content Credentials present (camera/editor)",
      };
    }
    // C2PA present but generator unknown — fall through to ML signal.
  }

  // ML path — probabilistic. Use the "Deepfake" probability and the
  // uncertain band to pick between three states.
  const p = res.mlDeepfakeScore;
  const hardAI = threshold + UNCERTAIN_HALF_WIDTH;
  const hardReal = threshold - UNCERTAIN_HALF_WIDTH;

  if (p >= hardAI) return { state: "ai", confidence: p };
  if (p <= hardReal) return { state: "authentic", confidence: 1 - p };
  return { state: "uncertain", confidence: p };
}

// ---- Badge rendering ------------------------------------------------------

function getContainer(img: HTMLImageElement): HTMLElement | null {
  let el: HTMLElement | null = img.parentElement;
  for (let i = 0; i < 6 && el; i++) {
    const pos = window.getComputedStyle(el).position;
    if (pos === "relative" || pos === "absolute" || pos === "sticky") return el;
    el = el.parentElement;
  }
  if (img.parentElement) {
    img.parentElement.style.position = "relative";
    return img.parentElement;
  }
  return null;
}

function removeBadge(img: HTMLImageElement): void {
  const existing = img.parentElement?.querySelector(".dfs-badge");
  existing?.remove();
}

function applyBadge(img: HTMLImageElement, decision: Decision): void {
  const container = getContainer(img);
  if (!container) return;

  const old = container.querySelector(".dfs-badge");
  old?.remove();

  const badge = document.createElement("div");
  badge.className = "dfs-badge";
  badge.dataset.state = decision.state;

  const pct = Math.round(decision.confidence * 100);

  if (decision.state === "scanning") {
    badge.innerHTML = `<span class="dfs-spinner"></span>`;
    badge.title = "DeepFake Shield: scanning...";
  } else if (decision.state === "verified-ai") {
    badge.innerHTML = `🛡️ <span>Verified AI</span>`;
    badge.title = `${decision.reason}`;
    // Verified states stay visible — they're a deterministic statement.
  } else if (decision.state === "verified-authentic") {
    badge.innerHTML = `🛡️ <span>Verified</span>`;
    badge.title = `${decision.reason}`;
    setTimeout(() => badge.remove(), 3000);
  } else if (decision.state === "ai") {
    badge.innerHTML = `⚠️ <span>Likely AI</span><em>${pct}%</em>`;
    badge.title = `DeepFake Shield: model classifies as likely AI-generated (${pct}% confidence)`;
  } else if (decision.state === "uncertain") {
    badge.innerHTML = `❓ <span>Uncertain</span><em>${pct}%</em>`;
    badge.title = `DeepFake Shield: model is uncertain (${pct}% deepfake probability). Could not make a confident call.`;
  } else {
    // authentic
    badge.innerHTML = `✓ <span>Likely Authentic</span><em>${pct}%</em>`;
    badge.title = `DeepFake Shield: likely authentic (${pct}% confidence)`;
    setTimeout(() => badge.remove(), 3000);
  }

  container.appendChild(badge);
}
