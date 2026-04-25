# Privacy Policy — DeepFake Shield

**Effective date:** April 25, 2026

## TL;DR

DeepFake Shield does not collect, store, or transmit any personal data. All image analysis happens locally on your device. The only network request the extension makes is a one-time download of the ML model from HuggingFace.

## What this extension accesses

When installed and enabled, DeepFake Shield can read and process the contents of pages you visit on `instagram.com`. Specifically, it:

- Reads image URLs from Instagram's CDN (`cdninstagram.com`, `fbcdn.net`)
- Sends those URLs to a local ML model running in your browser
- Overlays a small badge on images the model classifies

## What this extension does NOT do

- ❌ Does **not** send any image data, URLs, or other content to any external server
- ❌ Does **not** store image data
- ❌ Does **not** track which images, posts, or accounts you view
- ❌ Does **not** collect analytics or telemetry
- ❌ Does **not** use cookies or tracking pixels
- ❌ Does **not** sell, share, or transmit any personal data
- ❌ Does **not** use any third-party tracking SDKs

## What is stored locally on your device

Using Chrome's `chrome.storage.local` API, the extension stores:

| Data | Purpose |
|---|---|
| `enabled` (boolean) | Whether scanning is active |
| `threshold` (number) | Your detection confidence threshold |
| `blurDetected` (boolean) | Whether to blur flagged images |
| `scanCount` (number) | Anonymous count of images scanned |
| `flaggedCount` (number) | Anonymous count of images flagged |
| `modelStatus` (string) | Whether the model is loaded |

This data never leaves your device. You can clear it at any time by removing the extension or via Chrome's extension settings.

## What network requests the extension makes

**One** outbound request, on first run only:

- A request to `huggingface.co` to download the ML model file (~87MB)
- This file is cached by your browser permanently — no further requests needed

After this initial download, the extension functions entirely offline.

The extension also receives image URLs from Instagram's CDN, but these are images the page is already loading — the extension does not initiate additional fetches.

## Permissions explained

The extension requests these Chrome permissions:

| Permission | Why |
|---|---|
| `storage` | Save your settings and stats locally |
| `scripting` | Inject the content script into Instagram |
| `offscreen` | Required for running the ML model in a Web Worker |
| `host_permissions: instagram.com` | Allow the extension to read images on Instagram |

We do not request the `tabs`, `webNavigation`, `webRequest`, `cookies`, or any broader URL access permissions.

## Open source

The full source code is available at [github.com/akarshkathal/deepfake-shield](https://github.com/akarshkathal/deepfake-shield) under the MIT license. You can audit exactly what the extension does.

## Changes to this policy

If this policy ever changes (e.g., when a new feature is added), the change will be documented in the project's git history and announced in the release notes. Material changes will be communicated via a notice in the extension popup.

## Contact

For questions about this policy, open an issue at the GitHub repository linked above.
