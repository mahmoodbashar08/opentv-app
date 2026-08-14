/**
 * Decode a JPEG and hand its pixels to `dominantAccent` — the only impure step
 * between "the user tapped a backdrop" and "the profile has its colour".
 *
 * jpeg-js is pure JavaScript, which is the entire reason it was chosen: no
 * native module, no rebuild, works over metro the night it was added. A
 * w1280 backdrop decodes in well under a second on anything that runs this
 * app, and it happens once per theme change, behind the picker's existing
 * saving state.
 */
import { decode } from 'jpeg-js';

import { dominantAccent, secondaryAccent } from '@/pure';

export function accentFromJpeg(bytes: Uint8Array): string | null {
  try {
    const img = decode(bytes, { useTArray: true, maxMemoryUsageInMB: 64 });
    // Stride keeps the scan under ~100k samples whatever the frame size.
    const stride = Math.max(1, Math.floor((img.width * img.height) / 100_000));
    return dominantAccent(img.data, stride);
  } catch {
    // Not a JPEG after all, or truncated. No colour is a fine answer.
    return null;
  }
}

/**
 * BOTH COLOURS IN ONE DECODE. Decoding a JPEG is the expensive half and doing
 * it twice to ask two questions about the same pixels would be silly.
 *
 * `secondary` is null for artwork that genuinely has one colour in it, and
 * every caller must treat that as "use the primary for everything" rather than
 * inventing a partner for it.
 */
export function paletteFromJpeg(bytes: Uint8Array): { accent: string | null; secondary: string | null } {
  try {
    const img = decode(bytes, { useTArray: true, maxMemoryUsageInMB: 64 });
    const stride = Math.max(1, Math.floor((img.width * img.height) / 100_000));
    return { accent: dominantAccent(img.data, stride), secondary: secondaryAccent(img.data, stride) };
  } catch {
    return { accent: null, secondary: null };
  }
}
