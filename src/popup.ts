/**
 * popup.ts — DeepFake Shield popup logic (v0.2)
 *
 * v0.2: clarifies model status text and reflects that detection now
 * includes Content Credentials (C2PA), not just the ML model.
 */

const enabledToggle    = document.getElementById("enabled-toggle") as HTMLInputElement;
const blurToggle       = document.getElementById("blur-toggle") as HTMLInputElement;
const thresholdSlider  = document.getElementById("threshold") as HTMLInputElement;
const thresholdValue   = document.getElementById("threshold-value") as HTMLSpanElement;
const scanCount        = document.getElementById("scan-count") as HTMLSpanElement;
const flaggedCount     = document.getElementById("flagged-count") as HTMLSpanElement;
const statusDot        = document.getElementById("status-dot") as HTMLSpanElement;
const statusText       = document.getElementById("status-text") as HTMLSpanElement;
const resetBtn         = document.getElementById("reset-stats") as HTMLButtonElement;

// ---- Load initial values --------------------------------------------------

chrome.storage.local.get(
  ["enabled", "threshold", "blurDetected", "scanCount", "flaggedCount", "modelStatus"],
  (data) => {
    enabledToggle.checked = data.enabled ?? true;
    blurToggle.checked    = data.blurDetected ?? false;

    const thresh = Math.round((data.threshold ?? 0.75) * 100);
    thresholdSlider.value = String(thresh);
    thresholdValue.textContent = `${thresh}%`;

    scanCount.textContent    = String(data.scanCount ?? 0);
    flaggedCount.textContent = String(data.flaggedCount ?? 0);

    updateStatus(data.modelStatus ?? "idle");
  }
);

function updateStatus(status: string) {
  if (status === "ready") {
    setStatus("ready", "Detector ready · ML + Content Credentials");
  } else if (status === "loading") {
    setStatus("loading", "Downloading model (~87MB, first time only)...");
  } else if (status === "error") {
    setStatus("error", "Model failed to load — check console");
  } else {
    setStatus("loading", "Open Instagram to start the model");
  }
}

function setStatus(type: "ready" | "loading" | "error", text: string) {
  statusDot.className = `status-dot ${type}`;
  statusText.textContent = text;
}

// ---- Event listeners ------------------------------------------------------

enabledToggle.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabledToggle.checked });
});

blurToggle.addEventListener("change", () => {
  chrome.storage.local.set({ blurDetected: blurToggle.checked });
});

thresholdSlider.addEventListener("input", () => {
  const val = parseInt(thresholdSlider.value);
  thresholdValue.textContent = `${val}%`;
  chrome.storage.local.set({ threshold: val / 100 });
});

resetBtn.addEventListener("click", () => {
  chrome.storage.local.set({ scanCount: 0, flaggedCount: 0 }, () => {
    scanCount.textContent    = "0";
    flaggedCount.textContent = "0";
  });
});

// ---- Live updates ---------------------------------------------------------

chrome.storage.onChanged.addListener((changes) => {
  if (changes.scanCount)    scanCount.textContent    = String(changes.scanCount.newValue);
  if (changes.flaggedCount) flaggedCount.textContent = String(changes.flaggedCount.newValue);
  if (changes.modelStatus)  updateStatus(changes.modelStatus.newValue);
});
