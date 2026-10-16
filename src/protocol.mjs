// Wire protocol for the Bitwig bridge.
//
// We carry JSON over SysEx so it rides a plain MIDI port and the Bitwig-side
// control script can read/write it with the API's raw SysEx callbacks.
//
//   frame = F0 7D <ascii(JSON)> F7
//
//  * 0x7D is the MIDI "non-commercial / educational use" manufacturer ID.
//  * Payload bytes must be 7-bit, so the JSON is made ASCII-only first by
//    escaping every non-ASCII code point as \\uXXXX (safe for track/plugin
//    names in any language).
//  * Bitwig's sendSysex() takes a hex string; its setSysexCallback() delivers a
//    lowercase hex string (no spaces) *including* the F0..F7. Node/RtMidi works
//    in raw byte arrays. The helpers below cover both worlds.

export const SYSEX_START = 0xf0;
export const SYSEX_END = 0xf7;
export const MANUFACTURER = 0x7d;

/** Make a JS string safe to place inside a SysEx frame (ASCII only). */
function asciiSafe(str) {
  return str.replace(/[^\x00-\x7f]/g, (c) => {
    const hex = c.charCodeAt(0).toString(16).padStart(4, "0");
    return "\\u" + hex;
  });
}

/** JSON object -> MIDI byte array (F0 7D ... F7). */
export function encodeFrame(obj) {
  const json = asciiSafe(JSON.stringify(obj));
  const bytes = [SYSEX_START, MANUFACTURER];
  for (let i = 0; i < json.length; i++) bytes.push(json.charCodeAt(i) & 0x7f);
  bytes.push(SYSEX_END);
  return bytes;
}

/** MIDI byte array -> JSON object, or null if it isn't one of our frames. */
export function decodeFrame(input) {
  const arr = Array.from(input ?? []);
  if (arr.length < 3) return null;
  if (arr[0] !== SYSEX_START) return null;
  let end = arr.length;
  if (arr[end - 1] === SYSEX_END) end = arr.length - 1;
  let start = 1;
  if (arr[start] === MANUFACTURER) start = 2;
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(arr[i] & 0x7f);
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** True if a MIDI message looks like one of our SysEx frames. */
export function isBitwigFrame(input) {
  const arr = Array.from(input ?? []);
  return arr.length >= 4 && arr[0] === SYSEX_START && arr[1] === MANUFACTURER;
}

/** byte array -> lowercase hex string (for the Bitwig side / debugging). */
export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => (b & 0xff).toString(16).padStart(2, "0"))
    .join("");
}

/** hex string (spaces optional) -> byte array. */
export function hexToBytes(hex) {
  const cleaned = String(hex).replace(/\s+/g, "");
  const out = [];
  for (let i = 0; i + 1 < cleaned.length; i += 2) {
    out.push(parseInt(cleaned.substr(i, 2), 16));
  }
  return out;
}
