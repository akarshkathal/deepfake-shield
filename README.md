# 🛡 DeepFake Shield

A Chrome extension that detects AI-generated and deepfake images on Instagram — **entirely in your browser**. No servers, no API keys, no telemetry, no data ever leaves your device.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Manifest](https://img.shields.io/badge/manifest-v3-green.svg)
![Status](https://img.shields.io/badge/status-v0.2%20beta-yellow.svg)

> 🆕 **v0.2** adds Content Credentials (C2PA) detection — a deterministic signal that catches AI from DALL·E, Adobe Firefly, Photoshop AI, Meta AI, and others when present. The extension now shows three confidence states (Likely AI / Uncertain / Likely Authentic) instead of binary labels. The underlying ML model was upgraded to the mature v2 of the same family.
>
> ⚠️ **Honest disclosure:** the ML side is still best at face-swap deepfakes. It does **not** reliably catch Midjourney/FLUX art *unless* those images carry C2PA. Read the [Limitations](#known-limitations) section before installing.

## How it works

1. Content script observes Instagram's feed via `MutationObserver` and `IntersectionObserver`
2. Each visible image URL is forwarded to a background service worker
3. Service worker routes the request to an Offscreen Document
4. The Offscreen Document runs **two checks in parallel**:
   - **Content Credentials (C2PA)** — scans the image binary for C2PA manifests. Modern AI tools (DALL·E, Firefly, Photoshop AI, Meta AI) embed these. When present, we have a deterministic answer.
   - **ML inference** — a Vision Transformer ONNX model classifies the image as real vs deepfake.
5. Results combine: **C2PA wins when present** (deterministic), ML score is the fallback (probabilistic). The ML score is interpreted as a three-state outcome — Likely AI / Uncertain / Likely Authentic.
6. A colored badge is overlaid on the image with the verdict and confidence.

The model runs **100% on your machine**. The only network request is the initial download of the model from HuggingFace (~87MB, cached forever).

## Architecture

```
Instagram tab
    │
    ├── content.js (MutationObserver + IntersectionObserver)
    │       │ chrome.runtime.sendMessage({type: 'CLASSIFY', imageUrl})
    │       ▼
    ├── background.js (MV3 Service Worker)
    │       │ chrome.offscreen.createDocument(...)
    │       │ chrome.runtime.sendMessage({...target: 'offscreen'})
    │       ▼
    ├── offscreen.js (Offscreen Document - extension origin)
    │       ├── checkC2PA(imageUrl)              ◄── runs in parallel
    │       │       (lightweight binary scan)
    │       │
    │       └── new Worker('detector.worker.js')
    │               │ @huggingface/transformers pipeline()
    │               ▼
    │           { label, score, deepfakeScore }
    │
    │       ▼ combine both signals
    │   { mlLabel, mlScore, mlDeepfakeScore, c2pa: {...} }
    │       │ chrome.runtime.sendResponse
    │       ▼
    └── Badge overlaid on image — C2PA wins when present, else ML score
        with a three-state output (AI / Uncertain / Authentic)
```

### Why so many layers?

Chrome Manifest V3 imposes architectural constraints that aren't immediately obvious:

- **Service workers can't spawn Web Workers** (no `Worker` API in MV3 service worker context)
- **Content scripts can't load workers from `chrome-extension://` URLs** (cross-origin policy)
- **Offscreen Documents can do both** — they run in the extension origin AND have DOM access

The offscreen document is the home of our worker. The service worker just routes messages. This pattern is the canonical solution for ML inference in MV3 extensions.

## Quick start

### Prerequisites
- Node.js 18+
- npm

### Local development

```bash
git clone https://github.com/akarshkathal/deepfake-shield
cd deepfake-shield
npm install
npm run build
```

The built extension is now in the `dist/` folder.

### Load into Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder

Visit `instagram.com` — scanning starts automatically once the model loads (~30s on first run).

### Watch mode (for active development)

```bash
npm run dev
```

Rebuilds on file save. You still need to click the reload button on the extension card after changes.

## Project structure

```
deepfake-shield/
├── src/
│   ├── background.ts         MV3 service worker — routes messages, manages offscreen doc
│   ├── content.ts            Injected into instagram.com — observes feed, renders badges
│   ├── offscreen.ts          Hidden HTML doc — runs ML + C2PA in parallel, combines results
│   ├── detector.worker.ts    Runs the ONNX model via transformers.js
│   ├── c2pa.ts               Content Credentials (C2PA) detector — no external library
│   └── popup.ts              Settings UI logic
├── public/
│   ├── manifest.json         MV3 manifest with offscreen + scripting permissions
│   ├── offscreen.html        Empty shell that loads offscreen.js
│   ├── popup.html / popup.css
│   ├── content.css           Badge styles injected into Instagram
│   └── icons/                16, 48, 128px PNGs
├── vite.config.ts            5-entry build config + WASM copy
└── package.json
```

## Settings

Click the toolbar icon to access:

| Setting | Default | Description |
|---|---|---|
| Enabled | On | Master switch |
| Detection threshold | 75% | Minimum confidence to flag as AI |
| Blur detected images | Off | Auto-blur flagged content in feed |

Stats (scanned / flagged) update live as you scroll.

## Known limitations

This is beta software. Be honest about what works and what doesn't:

**✅ Highest confidence (Content Credentials path):**
Deterministic detection when the image carries a C2PA manifest. Currently caught:
- DALL·E 3 (OpenAI)
- Adobe Firefly
- Photoshop Generative Fill / Generative Expand
- Meta AI image generations
- Anything signed by a tool that embeds C2PA

**✅ Works reasonably well via the ML model:**
- Face-swap deepfakes (GAN-era)
- Photorealistic AI-generated faces (StyleGAN family)
- Some older AI image generators

**❌ Still struggles to detect (when C2PA is absent):**
- **Midjourney** images (v6 through v8.1) that don't carry C2PA
- **FLUX** generated images
- **Stable Diffusion** outputs (community-generated)
- **Stylized AI art** (illustrations, fantasy scenes, anime)
- Heavily compressed images that stripped metadata
- Videos (v0.2 is image-only)

**Why these limitations?** The ML model is trained primarily on GAN-based face deepfakes. It hasn't seen modern diffusion-model output during training, so it can't reliably detect it. The C2PA layer fills part of this gap — but only when the source tool embedded credentials. Many users save and re-share AI images, which often strips both EXIF and C2PA metadata, leaving us with only the (limited) ML signal.

**v0.3 plan:** train a custom model on the OpenFake/GenImage datasets which include Midjourney, FLUX, DALL·E 3, and Stable Diffusion outputs. Ensemble it with the current model.

**Recommendation:** treat **Verified AI** badges as definitive. Treat **Likely AI** as a useful signal worth a second look. Treat **Uncertain** as exactly that. Don't rely on **Likely Authentic** to mean "definitely real" — absence of evidence is not evidence of absence.

## Roadmap

- [x] **v0.1** — face-swap deepfake detection on Instagram
- [x] **v0.2** — Content Credentials (C2PA) detection, three-state confidence UX, mature v2 ML model
- [ ] **v0.3** — custom-trained model for Midjourney/FLUX/DALL-E detection (OpenFake dataset)
- [ ] **v0.4** — video frame analysis (Reels)
- [ ] **v0.5** — TikTok and Twitter/X support
- [ ] **v1.0** — Chrome Web Store release
- [ ] **v1.1** — Firefox port

## Contributing

Pull requests welcome! For larger changes, please open an issue first.

```bash
npm run dev          # Watch mode rebuild
npm run type-check   # TypeScript check (no build)
```

Ideas I'd love help with:
- Custom model training pipeline (OpenFake dataset)
- Test suite for known AI/real image samples
- UI/UX improvements to the popup
- Firefox compatibility layer

## Privacy

This extension does NOT:
- Send any data to any server (other than the one-time model download from HuggingFace)
- Track which images you view
- Store any image data
- Collect telemetry or analytics
- Use any tracking SDKs

It only stores in your browser:
- Your settings (threshold, blur, enabled)
- Anonymous counts of scanned/flagged images
- The cached ML model file

See [PRIVACY.md](PRIVACY.md) for full details.

## Tech stack

- **TypeScript** — strict mode
- **Vite** — multi-entry bundler
- **@huggingface/transformers** — ONNX runtime + model loading in browser
- **onnxruntime-web** — WebAssembly ML inference
- **Chrome Extensions Manifest V3** — service worker + offscreen documents

## Acknowledgments

- ML model: [`prithivMLmods/Deepfake-Detection-Exp-02-21`](https://huggingface.co/prithivMLmods/Deepfake-Detection-Exp-02-21) (Apache-2.0)
- Browser ML: [Hugging Face Transformers.js](https://github.com/huggingface/transformers.js)

## License

MIT — see [LICENSE](LICENSE)

Model license: Apache-2.0
