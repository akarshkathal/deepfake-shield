# 🛡 DeepFake Shield

A Chrome extension that detects AI-generated and deepfake images on Instagram — **entirely in your browser**. No servers, no API keys, no telemetry, no data ever leaves your device.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Manifest](https://img.shields.io/badge/manifest-v3-green.svg)
![Status](https://img.shields.io/badge/status-v0.1%20alpha-orange.svg)

> ⚠️ **Honest disclosure:** v0.1 is best at detecting face-swap deepfakes. It does **not** reliably catch Midjourney/FLUX/DALL-E art. Read the [Limitations](#known-limitations) section before installing.

## How it works

1. Content script observes Instagram's feed via `MutationObserver` and `IntersectionObserver`
2. Each visible image URL is forwarded to a background service worker
3. Service worker routes the request to an Offscreen Document (which has DOM/Worker access)
4. The Offscreen Document runs a Web Worker hosting an ONNX deepfake detection model via [Transformers.js](https://github.com/huggingface/transformers.js)
5. Results stream back through the chain → a colored badge is overlaid on the image

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
    │       │ new Worker('detector.worker.js')
    │       ▼
    └── detector.worker.js (Web Worker - ONNX inference)
            │ @huggingface/transformers pipeline()
            ▼
        { label: 'Deepfake' | 'Real', score: 0.87 }
            │ chrome.runtime.sendResponse
            ▼
        Badge overlaid on image in Instagram feed
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
│   ├── offscreen.ts          Hidden HTML doc — hosts the Web Worker
│   ├── detector.worker.ts    Runs the ONNX model via transformers.js
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

This is alpha software. Be aware of what works and what doesn't:

**✅ Works reasonably well on:**
- Face-swap deepfakes (the original GAN-style ones)
- Photorealistic AI-generated faces (StyleGAN, etc.)
- Some older AI image generators

**❌ Does NOT work well on:**
- **Midjourney** images (v5, v6, v7)
- **FLUX** generated images
- **DALL-E 3** outputs
- **Stylized AI art** (illustrations, fantasy scenes, anime)
- Any non-face-focused AI content
- Heavily compressed or filtered images
- Videos (v0.1 is image-only)

**Why these limitations?** The current model was trained primarily on GAN-based face deepfakes. It hasn't seen modern diffusion-model output during training, so it can't reliably detect it. v0.2 will address this by training a custom model on the OpenFake/GenImage datasets which include Midjourney, FLUX, DALL-E 3, and Stable Diffusion content.

**Recommendation:** Treat positive flags as useful signals, but don't rely on negative results to mean "definitely real." Use the 85%+ threshold to reduce false positives.

## Roadmap

- [x] **v0.1** — face-swap deepfake detection on Instagram
- [ ] **v0.2** — custom-trained model for Midjourney/FLUX/DALL-E detection
- [ ] **v0.3** — video frame analysis (Reels)
- [ ] **v0.4** — TikTok and Twitter/X support
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
