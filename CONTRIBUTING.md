# Contributing to DeepFake Shield

Thanks for your interest in contributing! This is a hobby/learning project, so contributions of all kinds are welcome.

## Ways to contribute

- 🐛 **Bug reports** — open an issue with steps to reproduce
- ✨ **Feature requests** — open an issue describing the use case
- 📝 **Documentation** — README improvements, code comments, etc.
- 🧪 **Test cases** — known AI/real images that the model misclassifies
- 🛠 **Code** — see open issues for ideas

## Getting started

```bash
git clone https://github.com/YOUR_USERNAME/deepfake-shield
cd deepfake-shield
npm install
npm run dev    # watch mode
```

Load the `dist/` folder as an unpacked extension in `chrome://extensions`.

## What I'd love help with

Listed roughly in order of impact:

1. **Custom-trained model** — replacing the current model with one fine-tuned on the OpenFake or GenImage datasets (which include Midjourney/FLUX/DALL-E 3 examples). This is the highest-impact change.
2. **Test fixtures** — a folder of known-AI and known-real image samples for benchmarking accuracy
3. **Firefox port** — adapt the manifest and offscreen pattern for Firefox WebExtensions
4. **TikTok / Twitter/X support** — abstract the Instagram-specific selectors into a platform adapter pattern
5. **Better confidence display** — visualize uncertainty better than a single percentage
6. **Account-level trust scores** — track repeated flags from the same account
7. **Improved DOM observers** — Instagram's class names change frequently; need more resilient image detection

## Code style

- TypeScript strict mode (no `any` unless commented why)
- Prefer explicit types over inference for public APIs
- Comments should explain *why*, not *what*
- Keep modules focused — one responsibility each
- Test that the extension still loads and runs after every change

## Pull request process

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/your-thing`
3. Make your changes
4. Run `npm run type-check` to ensure no TS errors
5. Run `npm run build` and verify the extension still works in Chrome
6. Commit with a descriptive message
7. Push and open a PR

For larger changes, please open an issue first to discuss the approach.

## Questions

Open an issue, or comment on an existing one. I'll respond when I can.
