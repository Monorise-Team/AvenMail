#!/usr/bin/env node
/**
 * Rysuje źródłową ikonę AvenMail (1024 × 1024 PNG): zaokrąglony kwadrat w barwach motywu Moonlight
 * i białą kopertę. Z niej `pnpm --filter @aven/desktop tauri icon` tworzy ikony wszystkich systemów.
 *
 *   node scripts/make-icon.mjs apps/desktop/src-tauri/icons/app-icon.png
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { deflateSync } from "node:zlib";

const SIZE = 1024;
const out = process.argv[2] ?? "apps/desktop/src-tauri/icons/app-icon.png";

const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v) => Math.max(0, Math.min(1, v));

/** Odległość od zaokrąglonego prostokąta (ujemna w środku). */
function roundedRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Odległość od odcinka. */
function segment(x, y, ax, ay, bx, by) {
  const t = clamp(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2));
  return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
}

const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    // Tło: kwadrat z zaokrągleniem (jak ikony macOS), od turkusu u góry do granatu na dole
    const shape = roundedRect(x, y, 512, 512, 440, 440, 200);
    const alpha = clamp(0.5 - shape);
    const t = y / SIZE;
    let r = mix(0x16, 0x05, t);
    let g = mix(0x6e, 0x16, t);
    let b = mix(0x86, 0x26, t);
    // Poświata „księżyca” w prawym górnym rogu
    const glow = clamp(1 - Math.hypot(x - 700, y - 300) / 420) ** 2 * 0.35;
    r = mix(r, 0xba, glow);
    g = mix(g, 0xec, glow);
    b = mix(b, 0xf5, glow);
    // Koperta: obrys prostokąta i dwie linie klapy
    const stroke = 34;
    const body = Math.abs(roundedRect(x, y, 512, 560, 250, 170, 40)) - stroke / 2;
    const flapLeft = segment(x, y, 280, 410, 512, 590) - stroke / 2;
    const flapRight = segment(x, y, 744, 410, 512, 590) - stroke / 2;
    const ink = clamp(0.5 - Math.min(body, flapLeft, flapRight));
    r = mix(r, 255, ink);
    g = mix(g, 255, ink);
    b = mix(b, 255, ink);
    pixels[i] = Math.round(r);
    pixels[i + 1] = Math.round(g);
    pixels[i + 2] = Math.round(b);
    pixels[i + 3] = Math.round(alpha * 255);
  }
}

// PNG: sygnatura, IHDR, IDAT (wiersze z filtrem 0), IEND
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header.set([8, 6, 0, 0, 0], 8);
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
console.log(`zapisano ${out}`);
