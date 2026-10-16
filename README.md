# bitwig-bridge

Drive **all of Bitwig** from the agent (or any script) over a **virtual MIDI port**.

Bitwig's only programmatic doorway is its **Control Surface API**, which runs
*inside* Bitwig. So the bridge is three pieces:

```
  me / MCP tools ──HTTP──▶ bitwigd ──virtual MIDI (SysEx RPC)──▶ AgentBridge.control.js ──▶ Bitwig Control API
```

* `bitwig/AgentBridge.control.js` — a Bitwig controller script that receives
  SysEx RPC frames and dispatches them to the Control Surface API.
* `bitwigd` — a Node daemon that opens the virtual MIDI ports, speaks the
  protocol, and exposes a local HTTP + WebSocket API.
* `src/mcp.mjs` — an MCP server (stdio) that wraps the HTTP API as `bitwig_*`
  tools for opencode.

The protocol is JSON over SysEx (`F0 7D <ascii json> F7`), which is 7-bit clean
and handles non-ASCII names.

## Setup

```bash
./install.sh          # npm install + copy the controller script into Bitwig
```

> **Why `snd-virmidi` is required:** Bitwig on Linux only opens ALSA
> **rawmidi** devices (`/dev/snd/midi*`) — see `snd_rawmidi_open` /
> `AlsaRawMidiApi` in the engine. It does *not* use the ALSA sequencer, so
> RtMidi's sequencer "virtual ports" are invisible to it. `snd-virmidi` creates
> dummy rawmidi devices that Bitwig *can* see (and that the sequencer can talk
> to, so `bitwigd` can attach to them).

```bash
sudo modprobe snd-virmidi index=10 midi_devs=1
echo snd-virmidi | sudo tee /etc/modules-load.d/snd-virmidi.conf          # load at boot
echo 'options snd-virmidi index=10 midi_devs=1' | sudo tee /etc/modprobe.d/snd-virmidi.conf
```

`index=10` pins the card number so the device name is stable across reboots
(without it the index shifts when the RME/Babyface is connected at boot, which
would silently break Bitwig's stored port assignment). `midi_devs=1` gives a
single device, "Virtual Raw MIDI 10-0".

Then, once, in Bitwig:

1. **Settings → Controllers → Add Controller → AgentBridge**
2. Set **MIDI in = "Virtual Raw MIDI 10-0"** and **MIDI out = "Virtual Raw MIDI 10-0"**
   (auto-discovery usually fills these in; otherwise pick by hand).
3. If the dropdown looks empty or shows stale entries, **restart Bitwig** so it
   re-scans rawmidi devices.
3. Start the daemon and smoke-test:

```bash
npm start                                   # bitwigd on 127.0.0.1:8765
curl -s localhost:8765/health
curl -s localhost:8765/call -d '{"cmd":"ping"}'
# -> {"ok":true,"result":{"pong":true,"version":"0.1.0","hostApiVersion":NN}}
```

If `ping` times out, Bitwig isn't running or the controller isn't connected.

## HTTP API

* `GET  /health` → `{ ok, connected, lastSeen }`
* `POST /call` with `{ "cmd": "...", "args": { ... } }` → `{ ok, result }`
* `WS   /events` → stream of unsolicited events (subscriptions, phase 3)

## Command set

Host API version: **17** (Bitwig 4.4.10).

| cmd | args | notes |
| --- | --- | --- |
| `ping` | — | liveness + host version |
| `js` / `eval` | `expr` | evaluate a JS expression against the bridge scope (dev/probe) |
| `transport.get` | — | playing/recording/overdub/loop/tempo/position |
| `transport.play` `.stop` `.toggle` `.record` `.restart` `.rewind` | — | `restart` starts playback from the start |
| `transport.toggle_loop` | — | |
| `transport.set_tempo` | `value` (BPM) | |
| `transport.set_position` | `value` (beats) | |
| `track.list` | — | name/type/mute/solo/arm/volume(norm)/pan(norm) |
| `track.select` | `index` | moves the cursor track |
| `track.set` | `index` + any of `name/mute/solo/arm/volume/pan` | |
| `scene.list` / `scene.launch` | — / `index` | |
| `cursor.get` | — | info for the currently selected track + device |
| `device.remotes` | — | cursor device's remote-control page: param names/values + page list |
| `device.set_param` | `index`,`value` | value normalized 0..1 |
| `device.next_page` / `.prev_page` | — | remote-control pages |
| `clip.create` | `slot`,`length?` | create+select a launcher clip on the cursor track |
| `clip.launch` | `slot?` | launch a launcher clip |
| `clip.write` | `step`,`y`,`velocity?`,`length?` | cursor clip note (velocity 0..127, length in beats) |
| `clip.clear` / `clip.clear_step` | — / `step`,`y` | clear the cursor clip (ALWAYS clear before rewriting) |
| `drum.pads` | — | list the cursor device's drum-machine pads |
| `app.undo` / `app.redo` / `app.duplicate` | — | |
| `app.can_undo` / `app.can_redo` | — | |

Everything is additive: adding a command means a `case` in `dispatch()` in the
controller script, plus (optionally) a named MCP tool.

### Bitwig API gotchas (learned the hard way)

* **`markInterested()` in `init()`.** You cannot read any value until you call
  `markInterested()` on it (or add an observer) during `init`. Reads otherwise
  throw *"Either call markInterested() or add at least one observer in init"*.
* **`loadAPI(N)` gates methods.** Too low and Bitwig errors *"only available for
  API versions after N"*. We declare the host max (17).
* **Reads are asynchronous.** A value read in the same tick as a `set` is stale;
  read it on a later call (or via an observer).
* **`restart()` starts playback** (not just repositioning).
* Values come from the **proxied Java API** (`com.bitwig.extension.controller.api`);
  the real method names live there (e.g. `isArrangerRecordEnabled`, not
  `isRecording`; `setName`, not `name().set`). `unzip bitwig.jar` + `javap` is
  the ground truth.

## Wire it into opencode

Add to `~/.config/opencode/opencode.json` under `mcp`:

```json
"bitwig": {
  "type": "local",
  "command": ["node", "/home/cure/bitwig-bridge/src/mcp.mjs"],
  "cwd": "/home/cure/bitwig-bridge",
  "enabled": true
}
```

Keep `bitwigd` running (`npm start`, or run it as a systemd --user service like
`beacond`). The MCP server talks to it over HTTP (`BITWIGD_URL`, default
`http://127.0.0.1:8765`).

## Scope / honesty

The Control API covers a very large surface (transport, tracks, scenes, devices,
remote controls, browser/preset loading, cursor-clip notes, application actions)
but not *literally* every operation (e.g. arbitrary arrangement-timeline surgery).
The dispatcher is designed so coverage is extended command by command.

## Layout

```
bitwig/AgentBridge.control.js   Bitwig-side RPC dispatcher
bin/bitwigd.mjs                 daemon entry
src/protocol.mjs                SysEx framing
src/bridge.mjs                  virtual MIDI + request/response
src/daemon.mjs                  HTTP + WS API
src/mcp.mjs                     MCP tools for opencode
test/protocol.test.mjs          framing round-trip tests
system/                         copies of the machine config this relies on
```

## System files (this machine, for reference)

`system/` mirrors the host config the bridge needs:

* `snd-virmidi.modules-load.conf` → `/etc/modules-load.d/snd-virmidi.conf`
* `snd-virmidi.modprobe.conf` → `/etc/modprobe.d/snd-virmidi.conf`
  (`options snd-virmidi index=10 midi_devs=1`)
* `bitwigd.service` → `~/.config/systemd/user/bitwigd.service`
