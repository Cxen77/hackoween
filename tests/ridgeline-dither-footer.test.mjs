import test from 'node:test';
import assert from 'node:assert/strict';

function rdfHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rdfPack(rgb) {
  return ((255 << 24) | (rgb[2] << 16) | (rgb[1] << 8) | rgb[0]) >>> 0;
}

function rdfDither(tone, n, b) {
  const t = tone < 0 ? 0 : tone > 1 ? 1 : tone;
  const v = Math.floor(t * (n - 1) + b);
  return v > n - 1 ? n - 1 : v;
}

function rdfElevation(crest, rows, layer, layers) {
  const up = rows > 0 ? 1 - Math.min(1, Math.max(0, crest / rows)) : 0;
  return Math.round(420 + up * 2600 + (layers - 1 - layer) * 140);
}

test('rdfHex correctly parses 3-character and 6-character hex colors', () => {
  assert.deepEqual(rdfHex('#fff'), [255, 255, 255]);
  assert.deepEqual(rdfHex('#121b26'), [18, 27, 38]);
  assert.equal(rdfHex('invalid'), null);
});

test('rdfPack packs RGB into a 32-bit little-endian integer with full alpha', () => {
  const packed = rdfPack([18, 27, 38]);
  assert.equal(typeof packed, 'number');
  assert.equal((packed >>> 24) & 255, 255); // full alpha
  assert.equal(packed & 255, 18); // red
  assert.equal((packed >>> 8) & 255, 27); // green
  assert.equal((packed >>> 16) & 255, 38); // blue
});

test('rdfDither clamps tones and bounds palette index strictly', () => {
  const n = 7;
  assert.equal(rdfDither(-0.5, n, 0.5), 0);
  assert.equal(rdfDither(1.5, n, 0.5), n - 1);
  const mid = rdfDither(0.5, n, 0.5);
  assert.ok(mid >= 0 && mid < n);
});

test('rdfElevation produces consistent altitude readout in metres', () => {
  const elevation = rdfElevation(50, 100, 0, 6);
  assert.ok(elevation >= 420 && elevation <= 4000);
});
