/**
 * c2pa.ts — Lightweight Content Credentials / C2PA detector
 *
 * Detects whether an image carries C2PA (Content Authenticity Initiative)
 * provenance metadata, and if so, tries to identify the generator.
 *
 * Why this matters: modern AI tools (DALL-E 3, Adobe Firefly, Photoshop's
 * Generative Fill, Meta Imagine, some Midjourney exports) embed C2PA
 * manifests inside the image file. When present, this gives us a
 * DETERMINISTIC answer — not an ML probability.
 *
 * Why we don't use the official c2pa-js library:
 * - It's heavy (WASM, ~2MB) and CSP-restrictive in extensions
 * - We only need presence + generator name, not full cryptographic verification
 * - Verification of signatures is great-to-have but not core to v0.2
 *
 * Approach: fetch the image bytes, scan the binary for known C2PA markers,
 * and extract generator name from XMP metadata which is plain XML.
 */

export type C2PAResult = {
  hasC2PA: boolean;
  generator?: string;
  isAIGenerated?: boolean;
};

/**
 * Known AI generators that embed C2PA. Order matters — more specific
 * patterns first.
 */
const GENERATOR_PATTERNS: Array<{ pattern: RegExp; name: string; isAI: boolean }> = [
  { pattern: /openai|dall[\s-]?e/i,        name: "DALL·E (OpenAI)",     isAI: true  },
  { pattern: /midjourney/i,                name: "Midjourney",          isAI: true  },
  { pattern: /adobe\s*firefly/i,           name: "Adobe Firefly",       isAI: true  },
  { pattern: /stable\s*diffusion/i,        name: "Stable Diffusion",    isAI: true  },
  { pattern: /stability\s*ai/i,            name: "Stability AI",        isAI: true  },
  { pattern: /meta\s*imagine|meta\s*ai/i,  name: "Meta AI",             isAI: true  },
  { pattern: /imagen|google\s*deepmind/i,  name: "Google Imagen",       isAI: true  },
  { pattern: /flux\.?1|black\s*forest/i,   name: "FLUX (Black Forest)", isAI: true  },
  { pattern: /grok|x\.ai/i,                name: "Grok (xAI)",          isAI: true  },
  // Editing tools — C2PA present but NOT inherently AI-generated
  { pattern: /generative\s*(fill|expand)/i, name: "Photoshop AI",       isAI: true  },
  { pattern: /photoshop/i,                 name: "Photoshop",           isAI: false },
  { pattern: /lightroom/i,                 name: "Lightroom",           isAI: false },
  { pattern: /capture\s*one/i,             name: "Capture One",         isAI: false },
];

/**
 * Markers that indicate a C2PA manifest is present in the file.
 * Based on the C2PA technical specification: manifests are stored in
 * JUMBF (JPEG Universal Metadata Box Format) boxes, identified by
 * the "jumb" 4-byte signature, and use URNs starting with "urn:uuid:"
 * or "urn:c2pa:".
 */
const C2PA_MARKERS = [
  "jumbf",
  "c2pa.manifest",
  "c2pa.actions",
  "c2pa.claim_generator",
  "urn:c2pa",
  "urn:uuid:c2pa",
];

/**
 * Maximum bytes to scan. C2PA manifests are typically in the first
 * ~256KB of a JPEG/PNG file. Scanning the whole file would be wasteful
 * for large images.
 */
const SCAN_BYTE_LIMIT = 262144;

export async function checkC2PA(imageUrl: string): Promise<C2PAResult> {
  try {
    const res = await fetch(imageUrl, {
      method: "GET",
      // Range request to grab only the start of the file — supported by
      // most CDNs including cdninstagram. If unsupported, server returns
      // 200 with full body and we just truncate.
      headers: { Range: `bytes=0-${SCAN_BYTE_LIMIT - 1}` },
      credentials: "omit",
      cache: "force-cache",
    });

    if (!res.ok && res.status !== 206) {
      return { hasC2PA: false };
    }

    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf, 0, Math.min(buf.byteLength, SCAN_BYTE_LIMIT));

    // Decode as latin1 — preserves byte values 1:1 so we can find ASCII
    // markers inside the binary without false UTF-8 errors.
    const text = new TextDecoder("latin1").decode(bytes);

    const hasC2PA = C2PA_MARKERS.some((marker) => text.includes(marker));
    if (!hasC2PA) return { hasC2PA: false };

    // Try to extract the generator name. We check both the C2PA claim
    // generator field and XMP metadata (xmp:CreatorTool, photoshop:Source).
    for (const gen of GENERATOR_PATTERNS) {
      if (gen.pattern.test(text)) {
        return {
          hasC2PA: true,
          generator: gen.name,
          isAIGenerated: gen.isAI,
        };
      }
    }

    // C2PA present but generator unknown. Still useful — we know the
    // image has provenance metadata, just can't say what made it.
    return { hasC2PA: true, isAIGenerated: undefined };
  } catch {
    // Network error, CORS, etc. Don't fail loud — just skip C2PA layer.
    return { hasC2PA: false };
  }
}
