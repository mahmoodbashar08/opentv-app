/**
 * A picture's two theme colours, read natively. (A pure-JS JPEG decoder used
 * to do this; on a phone it held the JS thread for seconds per pick — 4 Oct.)
 */
import { decodeBlurhash, dominantAccent, secondaryAccent } from '@/pure';

/**
 * Both colours from ANY picture the app can draw — a GIF or PNG included —
 * through its blurhash: expo-image summarises it natively, and the decoded grid
 * goes through the same `dominantAccent` a JPEG's pixels do. A 6×5 hash keeps
 * enough of a picture's colour to find its accent; 32×32 pixels are plenty to
 * read it from.
 */
export async function paletteFromImage(
  uri: string,
): Promise<{ accent: string | null; secondary: string | null; read: boolean }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Image } = require('expo-image') as typeof import('expo-image');
    const hash = await Image.generateBlurhashAsync(uri, [6, 5]);
    const px = hash ? decodeBlurhash(hash, 32, 32) : null;
    if (!px) return { accent: null, secondary: null, read: false };
    const bytes = new Uint8Array(px.buffer);
    // `read` with no accent means the picture really has no colour (black and
    // white) — a different answer from "could not look".
    return { accent: dominantAccent(bytes, 1), secondary: secondaryAccent(bytes, 1), read: true };
  } catch {
    return { accent: null, secondary: null, read: false };
  }
}
