/**
 * A screen frame as a PNG, for an MCP image: RGB, each pixel `scale` × `scale`. Node's zlib
 * does the compression; the rest of the format is a few chunks with CRCs.
 */

import { deflateSync } from 'node:zlib';
import { frameToRgba, type Frame } from 'blue11';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** An RGBA image (as `frameToRgba` gives it) as a PNG, each pixel scaled up. */
export function rgbaToPng(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, scale = 1): Buffer {
  const W = width * scale;
  const H = height * scale;
  const raw = Buffer.alloc(H * (1 + 3 * W));
  for (let y = 0; y < H; y++) {
    const row = y * (1 + 3 * W); // filter byte 0 (none), then RGB
    const sy = Math.floor(y / scale);
    for (let x = 0; x < W; x++) {
      const i = 4 * (sy * width + Math.floor(x / scale));
      raw[row + 1 + 3 * x] = rgba[i];
      raw[row + 2 + 3 * x] = rgba[i + 1];
      raw[row + 3 + 3 * x] = rgba[i + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** A frame as a PNG 256 pixels wide (mode 0 at 4×, mode 1 at 2×). */
export function frameToPng(frame: Frame): Buffer {
  return rgbaToPng(frameToRgba(frame), frame.width, frame.height, Math.max(1, Math.round(256 / frame.width)));
}
