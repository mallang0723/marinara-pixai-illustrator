const { test } = require('node:test');
const assert = require('node:assert/strict');
const { source } = require('./v2-helpers.cjs');
const fixture = require('./fixtures/pixai-style-presets.json');

// Captured from the public Create Image page on 2026-10-05; no API key or generation.
test('style allowlist equals 35 unique presets from the official public Create Image page', () => {
  const actual = JSON.parse(source.match(/const STYLE_PRESETS = (\[[^\n]+\]);/)[1]);
  assert.equal(fixture.presets.length, 35);
  assert.equal(new Set(fixture.presets).size, 35);
  assert.equal(actual.length, 35);
  assert.deepEqual(actual.slice().sort(), fixture.presets.slice().sort());
});
