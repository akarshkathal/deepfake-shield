/**
 * content.ts — Injected into https://www.instagram.com/*
 *
 * Sends image URLs to the background service worker, which routes them
 * to the offscreen document where the Web Worker runs the ML model.
 */

const scanned = new Set<string>();
let enabled = true;
let threshold = 0.75;
let blurDetected = false;

// ---- Settings -------------------------------------------------------------

chrome.storage.local.get(["enabled", "threshold", "blurDetected"], (result) => {
  enabled = result.enabled ?? true;
  threshold = result.threshold ?? 0.75;
  blurDetected = result.blurDetected ?? false;

  // Tell background to wake up the offscreen doc + start downloading the model
  if (enabled) {
    chrome.runtime.sendMessage({ type: "INIT_MODEL" }).catch(() => {
      // background not ready yet, that's fine - the first CLASSIFY will trigger it
    });
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

function processImage(img: HTMLImageElement): void {
  if (!enabled) return;

  const id = Math.random().toString(36).slice(2);
  applyBadge(img, "scanning", 0);

  chrome.runtime.sendMessage(
    { type: "CLASSIFY", id, imageUrl: img.src },
    (response: { label?: "Real" | "Deepfake"; score?: number; error?: string } | undefined) => {
      if (chrome.runtime.lastError) {
        console.warn("[DeepFake Shield]", chrome.runtime.lastError.message);
        removeBadge(img);
        return;
      }
      if (!response || response.error || !response.label) {
        removeBadge(img);
        return;
      }
      handleResult(img, response.label, response.score!);
    }
  );
}

function handleResult(img: HTMLImageElement, label: "Real" | "Deepfake", score: number): void {
  chrome.storage.local.get(["scanCount", "flaggedCount"], (data) => {
    const scanCount = (data.scanCount ?? 0) + 1;
    const flaggedCount =
      (data.flaggedCount ?? 0) + (label === "Deepfake" && score >= threshold ? 1 : 0);
    chrome.storage.local.set({ scanCount, flaggedCount });
  });

  const isDeepfake = label === "Deepfake" && score >= threshold;
  const state = isDeepfake ? "deepfake" : "real";
  applyBadge(img, state, score);

  if (isDeepfake && blurDetected) {
    img.style.filter = "blur(12px)";
    img.style.transition = "filter 0.3s ease";
  }
}

// ---- Badge rendering ------------------------------------------------------

type BadgeState = "scanning" | "deepfake" | "real";

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

function applyBadge(img: HTMLImageElement, state: BadgeState, score: number): void {
  const container = getContainer(img);
  if (!container) return;

  const old = container.querySelector(".dfs-badge");
  old?.remove();

  const badge = document.createElement("div");
  badge.className = "dfs-badge";
  badge.dataset.state = state;

  if (state === "scanning") {
    badge.innerHTML = `<span class="dfs-spinner"></span>`;
    badge.title = "DeepFake Shield: scanning...";
  } else if (state === "deepfake") {
    const pct = Math.round(score * 100);
    badge.innerHTML = `⚠️ <span>AI Generated</span><em>${pct}%</em>`;
    badge.title = `DeepFake Shield: likely AI-generated (${pct}% confidence)`;
  } else {
    const pct = Math.round(score * 100);
    badge.innerHTML = `✓ <span>Authentic</span><em>${pct}%</em>`;
    badge.title = `DeepFake Shield: likely authentic (${pct}% confidence)`;
    setTimeout(() => badge.remove(), 3000);
  }

  container.appendChild(badge);
}
