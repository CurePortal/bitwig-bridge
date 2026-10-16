// Protocol round-trip tests (no MIDI needed): encode -> decode, unicode safety.
import assert from "node:assert/strict";
import { encodeFrame, decodeFrame, isBitwigFrame, bytesToHex, hexToBytes } from "../src/protocol.mjs";

function roundtrip(obj) {
  const bytes = encodeFrame(obj);
  assert.ok(isBitwigFrame(bytes), "should look like a frame");
  assert.equal(bytes[0], 0xf0);
  assert.equal(bytes[1], 0x7d);
  assert.equal(bytes[bytes.length - 1], 0xf7);
  for (const b of bytes) assert.ok(b >= 0 && b <= 0xff, "byte range");
  return decodeFrame(bytes);
}

// basic
assert.deepEqual(roundtrip({ id: 1, cmd: "ping", args: {} }), { id: 1, cmd: "ping", args: {} });

// unicode in payloads (track / plugin names in any language)
const named = { id: 42, cmd: "track.set", args: { name: "Båss – 低音 🔊" } };
assert.deepEqual(roundtrip(named), named);

// hex helpers used by the Bitwig side
const bytes = encodeFrame({ id: 7, ok: true, result: { pong: true } });
assert.deepEqual(hexToBytes(bytesToHex(bytes)), bytes);

// reject foreign sysex
assert.equal(isBitwigFrame([0xf0, 0x42, 0x01, 0xf7]), false);
assert.equal(decodeFrame([0xf0, 0x42, 0x01, 0xf7]), null);

console.log("protocol tests: OK");
