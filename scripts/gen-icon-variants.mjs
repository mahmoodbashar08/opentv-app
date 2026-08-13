/**
 * Alternate app icons = the shipped icon with its yellow "T" recoloured.
 * Only the saturated pixels move; the white "O" and the black field stay put.
 *
 * Run: node scripts/gen-icon-variants.mjs   → assets/icons/<accent>.png
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

import { PNG } from 'pngjs';

const VARIANTS = { orange: '#FF8A1E', purple: '#8B5CF6', teal: '#14C8B8' };

const src = PNG.sync.read(readFileSync('assets/images/icon.png'));
mkdirSync('assets/icons', { recursive: true });

for (const [name, hex] of Object.entries(VARIANTS)) {
  const to = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = new PNG({ width: src.width, height: src.height });
  src.data.copy(out.data);
  for (let i = 0; i < out.data.length; i += 4) {
    const [r, g, b] = [out.data[i], out.data[i + 1], out.data[i + 2]];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // Saturated => it is the yellow mark. Grey (the O, the field) is left alone.
    if (max === 0 || (max - min) / max < 0.25) continue;
    const scale = max / 255;
    out.data[i] = Math.round(to[0] * scale);
    out.data[i + 1] = Math.round(to[1] * scale);
    out.data[i + 2] = Math.round(to[2] * scale);
  }
  writeFileSync(`assets/icons/${name}.png`, PNG.sync.write(out));
  console.log(`assets/icons/${name}.png`);
}
