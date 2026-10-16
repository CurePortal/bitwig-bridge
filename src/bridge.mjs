// BitwigBridge: owns the MIDI connection and does request/response over the
// SysEx wire protocol.
//
// IMPORTANT: Bitwig on Linux talks to ALSA **rawmidi** devices
// (/dev/snd/midi*, via snd_rawmidi_open) -- NOT the ALSA sequencer. RtMidi's
// "virtual ports" are sequencer-only, so Bitwig cannot see them. We therefore
// prefer to attach to a rawmidi device created by `snd-virmidi` (it exposes
// itself to the sequencer too, so RtMidi can open it), and fall back to a
// sequencer virtual port only if no such device exists.
//
// Modes (env `BITWIG_MIDI_MODE` = auto|device|virtual):
//   device  -> open the ALSA port matching `BITWIG_MIDI_PORT` (default:
//              /Virtual Raw MIDI/i). This is what Bitwig can actually see.
//   virtual -> open a sequencer virtual port pair (only useful for other
//              sequencer-aware hosts; Bitwig will NOT see these).

import midi from "@julusian/midi";
import { EventEmitter } from "node:events";
import { encodeFrame, decodeFrame, isBitwigFrame } from "./protocol.mjs";

const { Input, Output } = midi;

function findPortByName(device, pattern) {
  const rx = pattern instanceof RegExp ? pattern : new RegExp(pattern, "i");
  for (let i = 0; i < device.getPortCount(); i++) {
    const name = device.getPortName(i);
    if (rx.test(name)) return { index: i, name };
  }
  return null;
}

export class BitwigBridge extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.cmdOutName = opts.cmdOutName ?? "Bitwig Agent";
    this.replyInName = opts.replyInName ?? "Bitwig Agent Reply";
    this.midiMode = opts.midiMode ?? process.env.BITWIG_MIDI_MODE ?? "auto";
    this.portPattern = opts.portPattern ?? process.env.BITWIG_MIDI_PORT ?? "Virtual Raw MIDI";
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.pending = new Map();
    this._id = 1;
    this._open = false;
    this.lastSeen = 0;
    this.mode = null;
    this.portName = null;
  }

  open() {
    if (this._open) return;
    this.out = new Output();
    this.in = new Input();

    const wantDevice = this.midiMode !== "virtual";
    const rx = new RegExp(this.portPattern, "i");
    const outHit = wantDevice ? findPortByName(this.out, rx) : null;
    const inHit = wantDevice ? findPortByName(this.in, rx) : null;

    if (outHit && inHit) {
      this.out.openPort(outHit.index);
      this.in.openPort(inHit.index);
      this.mode = "device";
      this.portName = outHit.name;
    } else {
      this.out.openVirtualPort(this.cmdOutName);
      this.in.openVirtualPort(this.replyInName);
      this.mode = "virtual";
      this.portName = `${this.cmdOutName} / ${this.replyInName}`;
    }

    this.in.on("message", (_delta, msg) => this._onMessage(msg));
    this.in.ignoreTypes(false, true, true); // accept sysex, ignore clock/active-sense
    this._open = true;
    this.emit("open", { mode: this.mode, portName: this.portName });
  }

  close() {
    try { this.out?.closePort(); } catch {}
    try { this.in?.closePort(); } catch {}
    this._open = false;
  }

  get connected() {
    return this.lastSeen > 0 && Date.now() - this.lastSeen < 30000;
  }

  _onMessage(msg) {
    if (!isBitwigFrame(msg)) return;
    const frame = decodeFrame(msg);
    if (!frame) return;
    this.lastSeen = Date.now();

    if (frame.event !== undefined) {
      this.emit("event", frame);
      return;
    }
    const { id } = frame;
    if (id != null && this.pending.has(id)) {
      const { resolve, reject, timer } = this.pending.get(id);
      clearTimeout(timer);
      this.pending.delete(id);
      if (frame.ok) resolve(frame.result);
      else reject(new Error(frame.error || "bitwig error"));
    } else {
      this.emit("event", frame);
    }
  }

  /** Send a command and resolve with Bitwig's result (or reject on error/timeout). */
  call(cmd, args = {}) {
    if (!this._open) throw new Error("bridge not open");
    const id = this._id++;
    const bytes = encodeFrame({ id, cmd, args });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for '${cmd}' (is Bitwig running with the AgentBridge controller enabled?)`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.out.sendMessage(bytes);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
}
