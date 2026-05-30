# DeepFake Shield v0.2 — Apply Instructions

## What's in this archive

10 files that replace their counterparts in your repo:

```
src/
  c2pa.ts              ← NEW file (Content Credentials detector)
  detector.worker.ts   ← model swap + dual-score return
  offscreen.ts         ← parallel C2PA + ML, combined results
  background.ts        ← updated routing + preserves prefs on update
  content.ts           ← three-state badge logic, C2PA priority
  popup.ts             ← updated status text
public/
  content.css          ← new state styles (uncertain, verified)
  manifest.json        ← v0.2.0 + cdn host permissions
package.json           ← v0.2.0
README.md              ← honest v0.2 changelog
```

## How to apply

From the root of your `deepfake-shield` repo:

```bash
# 1. Make sure your work is committed/stashed first
git status

# 2. Create a branch for v0.2
git checkout -b v0.2

# 3. Unzip this patch on top of the repo
#    (this overwrites the old files — that's what you want)
unzip -o ~/Downloads/deepfake-shield-v0.2-patch.zip -d .

# 4. Install (no new dependencies, but lockfile may shift)
npm install

# 5. Build and verify
npm run build

# 6. Load dist/ into chrome://extensions (Developer mode → Load unpacked)
```

## Testing v0.2

To see the new behavior, try these on Instagram:

1. **Verified AI badge (🛡️ red, deterministic):** Find a post that's a re-share of a DALL·E or Adobe Firefly image. If the C2PA metadata survived, you'll see this badge with the generator name in the tooltip.

2. **Uncertain badge (❓ amber):** Look for stylized illustrations or AI portraits that aren't obvious GAN face-swaps. v0.1 would have flagged these as Real or AI with high confidence (often wrongly). v0.2 should honestly say "I'm not sure."

3. **Likely AI / Likely Authentic:** Same as v0.1 but only when the model is genuinely confident (above 85% by default — see `UNCERTAIN_HALF_WIDTH` in content.ts to tune).

## Commit message suggestion

```
v0.2: add Content Credentials (C2PA) detection + three-state UX

- New c2pa.ts module scans image bytes for C2PA manifests, no
  external library. Detects DALL·E, Firefly, Photoshop AI, Meta AI,
  FLUX, and others when their provenance metadata survives.
- ML model upgraded to onnx-community/Deep-Fake-Detector-v2-Model-ONNX
  (mature v2 of the same family, properly hosted, drop-in compatible).
- Three-state decision logic: Verified (C2PA) / AI (ML high) /
  Uncertain (ML gray zone) / Authentic (ML high other way). C2PA wins
  over ML when present.
- Confidence percentage always shown on the badge.
- onInstalled now preserves user prefs on update instead of resetting.
- Honest documentation refresh.

Known limitation unchanged: ML side still trained primarily on
GAN-era face deepfakes; modern diffusion outputs without C2PA
will still slip past. v0.3 plan: custom model on OpenFake/GenImage.
```

## Quick verification before pushing

```bash
# Build should pass with no errors:
npm run build

# Verify C2PA module made it into the bundle:
grep -c "checkC2PA\|c2pa" dist/offscreen.js   # → 1 or more

# Verify the model name swap:
grep "Deep-Fake-Detector-v2" dist/detector.worker.js   # → match
```

## If something breaks

The two most likely runtime errors and fixes:

**1. CORS error fetching image for C2PA:**
If the Instagram CDN URL refuses to send a Range request to your extension, the C2PA fetch will fail silently and the badge falls back to ML-only. That's by design — won't crash anything. If you want stricter, you can route the fetch through the background service worker (which has more network freedom) via a new message type.

**2. Model fails to load on first run:**
The new model URL (`onnx-community/Deep-Fake-Detector-v2-Model-ONNX`) downloads fresh on first load. If it 404s for any reason, fall back to the v0.1 model by changing the `MODEL_ID` constant at the top of `src/detector.worker.ts` back to `"prithivMLmods/Deepfake-Detection-Exp-02-21-ONNX"`.

## What's NOT in this patch (intentionally)

- No new dependencies (kept it pure)
- No tests yet (out of scope for v0.2)
- No new icons (existing ones still fit)
- No popup HTML changes (no new settings exposed yet)

Ship it.
