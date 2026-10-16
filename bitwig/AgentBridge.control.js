// AgentBridge -- Bitwig Studio controller script.
//
// Turns the Control Surface API into a small SysEx RPC server so an external
// process (the `bitwigd` daemon) can drive Bitwig.
//
// Wire format (matches src/protocol.mjs):
//   frame = F0 7D <ascii(JSON)> F7
//   request  { id, cmd, args }
//   response { id, ok, result } | { id, ok:false, error }
//
// Install: ~/Bitwig Studio/Controller Scripts/AgentBridge/AgentBridge.control.js
// Settings -> Controllers -> AgentBridge, MIDI in/out = "Virtual Raw MIDI 10-0"

loadAPI(17);

host.defineController("AgentBridge", "AgentBridge", "0.1.0", "b3d1a2c0-0000-4000-8000-000000000001");
host.defineMidiPorts(1, 1);
host.addDeviceNameBasedDiscoveryPair(["Virtual Raw MIDI 10-0"], ["Virtual Raw MIDI 10-0"]);
host.addDeviceNameBasedDiscoveryPair(["Bitwig Agent"], ["Bitwig Agent Reply"]);

var VERSION = "0.1.0";
var MFR = 0x7D;

var transport, application, trackBank, cursorTrack, cursorDevice, cursorClip, cursorClipSlots, drumPads, sceneBank, remotes, masterTrack, masterDevices, masterCursorDevice, masterRemotes, midiIn, midiOut;

// ---------------------------------------------------------------- lifecycle

function init() {
    midiIn = host.getMidiInPort(0);
    midiOut = host.getMidiOutPort(0);
    midiIn.setSysexCallback(onSysex);
    midiIn.setMidiCallback(onMidi);

    transport = host.createTransportSection();
    application = host.createApplicationSection();
    trackBank = host.createTrackBankSection(24, 2, 0);
    cursorTrack = host.createCursorTrackSection(0, 16);
    cursorDevice = host.createCursorDeviceSection(8);
    cursorClipSlots = cursorTrack.getClipLauncherSlots();
    cursorClip = cursorTrack.createLauncherCursorClip(16, 128);
    drumPads = cursorDevice.createDrumPadBank(16);
    sceneBank = host.createSceneBank(16);
    remotes = cursorDevice.createCursorRemoteControlsPage(8);
    masterTrack = host.createMasterTrackSection(0);
    masterDevices = masterTrack.createDeviceBank(16);
    masterCursorDevice = masterTrack.createCursorDevice("AgentBridge");
    masterRemotes = masterCursorDevice.createCursorRemoteControlsPage(8);

    // Bitwig requires every readable value to be subscribed to ("interested")
    // during init, otherwise reading it throws. Wrap each so one bad call can't
    // abort script loading.
    mi(transport.isPlaying());
    mi(transport.isArrangerRecordEnabled());
    mi(transport.isArrangerOverdubEnabled());
    mi(transport.isArrangerLoopEnabled());
    mi(transport.getTempo());
    mi(transport.getPosition());

    var n = trackBank.getSizeOfBank();
    for (var i = 0; i < n; i++) {
        var t = trackBank.getItemAt(i);
        mi(t.name()); mi(t.trackType()); mi(t.getMute()); mi(t.getSolo());
        mi(t.getArm()); mi(t.getVolume()); mi(t.getPan());
    }

    var sn = sceneBank.getSizeOfBank();
    for (var j = 0; j < sn; j++) mi(sceneBank.getScene(j).name());

    mi(cursorDevice.name());
    for (var m = 0; m < masterDevices.getSizeOfBank(); m++) mi(masterDevices.getItemAt(m).name());
    for (var k = 0; k < 8; k++) {
        var rp = remotes.getParameter(k);
        mi(rp); mi(rp.name()); mi(rp.value());
    }
    mi(remotes.pageNames());
    mi(remotes.selectedPageIndex());
    mi(remotes.pageCount());

    mi(masterCursorDevice.name());
    for (var mm = 0; mm < 8; mm++) {
        var mp = masterRemotes.getParameter(mm);
        mi(mp); mi(mp.name()); mi(mp.value());
    }
    mi(masterRemotes.pageNames());
    mi(masterRemotes.selectedPageIndex());

    for (var dp = 0; dp < drumPads.getSizeOfBank(); dp++) mi(drumPads.getItemAt(dp).name());
    for (var cs = 0; cs < cursorClipSlots.getSizeOfBank(); cs++) mi(cursorClipSlots.getItemAt(cs).hasContent());

    mi(cursorTrack.name());
    mi(cursorTrack.position());
    mi(cursorTrack.getVolume());
    mi(cursorTrack.getPan());
    mi(cursorTrack.getMute());
    mi(cursorTrack.getSolo());
    mi(cursorTrack.getArm());

    mi(application.canUndo());
    mi(application.canRedo());

    println("AgentBridge " + VERSION + " ready (host API " + host.getHostApiVersion() + ")");
}

function mi(v) {
    try { v.markInterested(); } catch (e) {}
}

function exit() {}
function flush() {}
function onMidi(status, data1, data2) {}

// ------------------------------------------------------------- wire helpers

function hexToBytes(hex) {
    var s = "" + hex;
    var cleaned = "";
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        if (c !== " ") cleaned += c;
    }
    var out = [];
    for (var j = 0; j + 1 < cleaned.length; j += 2) out.push(parseInt(cleaned.substr(j, 2), 16));
    return out;
}

function bytesToHex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) {
        var h = (bytes[i] & 0xFF).toString(16);
        if (h.length < 2) h = "0" + h;
        s += h;
    }
    return s;
}

function asciiSafe(str) {
    var out = "";
    for (var i = 0; i < str.length; i++) {
        var code = str.charCodeAt(i);
        if (code > 0x7F) {
            var hx = code.toString(16);
            while (hx.length < 4) hx = "0" + hx;
            out += "\\u" + hx;
        } else {
            out += str.charAt(i);
        }
    }
    return out;
}

function sendFrame(obj) {
    var json = asciiSafe(JSON.stringify(obj));
    var bytes = [0xF0, MFR];
    for (var i = 0; i < json.length; i++) bytes.push(json.charCodeAt(i) & 0x7F);
    bytes.push(0xF7);
    midiOut.sendSysex(bytesToHex(bytes));
}

function decodeFrame(hex) {
    var bytes = hexToBytes(hex);
    if (bytes.length < 4) return null;
    if (bytes[0] !== 0xF0) return null;
    var end = bytes.length;
    if (bytes[end - 1] === 0xF7) end = end - 1;
    var start = 1;
    if (bytes[start] === MFR) start = start + 1;
    var s = "";
    for (var i = start; i < end; i++) s += String.fromCharCode(bytes[i] & 0x7F);
    try { return JSON.parse(s); } catch (e) { return null; }
}

// --------------------------------------------------------------- value util

function str(v) {
    if (v === null || v === undefined) return null;
    try { return "" + v; } catch (e) { return null; }
}

// -------------------------------------------------- small value readers

function b(v) { try { return v.get(); } catch (e) { return null; } }
function num(v) { try { return v.get(); } catch (e) { return null; } }
function raw(v) { try { return v.getRaw(); } catch (e) { return null; } }
function sget(v) { try { return "" + v.get(); } catch (e) { return null; } }

// ------------------------------------------------------------------ dispatch

function onSysex(hex) {
    var req = decodeFrame(hex);
    if (!req || req.id == null) return;
    var res;
    try {
        res = { id: req.id, ok: true, result: dispatch(req.cmd, req.args || {}) };
    } catch (e) {
        res = { id: req.id, ok: false, error: "" + e };
    }
    sendFrame(res);
}

function dispatch(cmd, args) {
    switch (cmd) {
        case "ping":
            return { pong: true, version: VERSION, hostApiVersion: host.getHostApiVersion(), hostVersion: host.getHostVersion() };

        case "js": return jsEval(args.expr);
        case "eval": return jsEval(args.expr);

        // ---- transport
        case "transport.get": return transportGet();
        case "transport.play": transport.play(); return { ok: true };
        case "transport.stop": transport.stop(); return { ok: true };
        case "transport.toggle": transport.togglePlay(); return { ok: true };
        case "transport.record": transport.record(); return { ok: true };
        case "transport.restart": transport.restart(); return { ok: true };
        case "transport.rewind": transport.rewind(); return { ok: true };
        case "transport.toggle_loop": transport.toggleLoop(); return { ok: true };
        case "transport.set_tempo": transport.getTempo().setRaw(args.value); return { ok: true };
        case "transport.set_position": transport.getPosition().set(args.value); return { ok: true };

        // ---- tracks
        case "track.list": return trackList();
        case "track.select": trackBank.getItemAt(args.index).select(); return { ok: true };
        case "track.set": return trackSet(args);

        // ---- scenes
        case "scene.list": return sceneList();
        case "scene.launch": sceneBank.getScene(args.index).launch(); return { ok: true };

        // ---- device (cursor track's current device)
        case "device.remotes": return deviceRemotes();
        case "device.set_param": return deviceSetParam(args);
        case "device.next_page": remotes.selectNextPage(true); return { ok: true };
        case "device.prev_page": remotes.selectPreviousPage(true); return { ok: true };

        // ---- cursor clip notes
        case "clip.create": return clipCreate(args);
        case "clip.launch": cursorClipSlots.launch(args.slot != null ? args.slot : 0); return { ok: true };
        case "clip.write": return clipWrite(args);
        case "clip.clear": cursorClip.clearSteps(); return { ok: true };
        case "clip.clear_step": cursorClip.clearStep(args.step, args.y); return { ok: true };
        case "drum.pads": return drumPadsList();

        // ---- application
        case "app.undo": application.undo(); return { ok: true };
        case "app.redo": application.redo(); return { ok: true };
        case "app.duplicate": application.duplicate(); return { ok: true };
        case "app.can_undo": return { canUndo: b(application.canUndo()) };
        case "app.can_redo": return { canRedo: b(application.canRedo()) };

        // ---- cursor track
        case "cursor.get": return cursorGet();

        // ---- device insertion / chains
        case "device.insert": return deviceInsert(args);
        case "master.devices": return deviceBankList(masterDevices);

        // ---- master-chain device tuning
        case "master.select": masterCursorDevice.selectDevice(masterDevices.getItemAt(args.index)); return { ok: true };
        case "master.remotes": return remotesOf(masterRemotes, masterCursorDevice);
        case "master.set_param": masterRemotes.getParameter(args.index).set(args.value); return { ok: true };
        case "master.next_page": masterRemotes.selectNextPage(true); return { ok: true };
        case "master.prev_page": masterRemotes.selectPreviousPage(true); return { ok: true };
    }
    throw new Error("unknown command: " + cmd);
}

function deviceInsert(args) {
    if (!args.path) throw new Error("path required");
    var ip;
    if (args.where === "master") ip = masterTrack.endOfDeviceChainInsertionPoint();
    else if (args.index != null) ip = trackBank.getItemAt(args.index).endOfDeviceChainInsertionPoint();
    else throw new Error("where='master' or index required");
    ip.insertFile(args.path);
    return { ok: true, path: args.path };
}

function deviceBankList(bank) {
    var out = [];
    var n = bank.getSizeOfBank();
    for (var i = 0; i < n; i++) {
        var nm = sget(bank.getItemAt(i).name());
        if (nm !== null && nm !== "") out.push({ index: i, name: nm });
    }
    return out;
}

function cursorGet() {
    return {
        position: num(cursorTrack.position()),
        name: sget(cursorTrack.name()),
        volume: num(cursorTrack.getVolume()),
        pan: num(cursorTrack.getPan()),
        mute: b(cursorTrack.getMute()),
        solo: b(cursorTrack.getSolo()),
        arm: b(cursorTrack.getArm()),
        device: sget(cursorDevice.name()),
    };
}

// ----------------------------------------------------------------- transport

function transportGet() {
    return {
        playing: b(transport.isPlaying()),
        recording: b(transport.isArrangerRecordEnabled()),
        overdub: b(transport.isArrangerOverdubEnabled()),
        loop: b(transport.isArrangerLoopEnabled()),
        tempo: raw(transport.getTempo()),
        position: num(transport.getPosition()),
    };
}

// -------------------------------------------------------------------- tracks

function trackInfo(i) {
    var t = trackBank.getItemAt(i);
    var info = { index: i };
    info.name = sget(t.name());
    info.type = sget(t.trackType());
    info.mute = b(t.getMute());
    info.solo = b(t.getSolo());
    info.arm = b(t.getArm());
    info.volume = num(t.getVolume());
    info.pan = num(t.getPan());
    return info;
}

function trackList() {
    var out = [];
    var n = trackBank.getSizeOfBank();
    for (var i = 0; i < n; i++) out.push(trackInfo(i));
    return out;
}

function trackSet(args) {
    if (args.index == null) throw new Error("index required");
    var t = trackBank.getItemAt(args.index);
    if (args.name != null) t.setName("" + args.name);
    if (args.mute != null) t.getMute().set(!!args.mute);
    if (args.solo != null) t.getSolo().set(!!args.solo);
    if (args.arm != null) t.getArm().set(!!args.arm);
    if (args.volume != null) t.getVolume().set(args.volume);
    if (args.pan != null) t.getPan().set(args.pan);
    return { ok: true };
}

// -------------------------------------------------------------------- scenes

function sceneList() {
    var out = [];
    var n = sceneBank.getSizeOfBank();
    for (var i = 0; i < n; i++) {
        var s = sceneBank.getScene(i);
        out.push({ index: i, name: sget(s.name()) });
    }
    return out;
}

// -------------------------------------------------------------------- device

function remotesOf(rc, dev) {
    var params = [];
    var count = 8;
    try { count = rc.getParameterCount(); } catch (e) {}
    for (var i = 0; i < count; i++) {
        var p = rc.getParameter(i);
        params.push({ index: i, name: sget(p.name()), value: num(p) });
    }
    var pages = null;
    try { pages = rc.pageNames().get(); } catch (e) {}
    var page = null;
    try { page = rc.selectedPageIndex().get(); } catch (e) {}
    return { device: sget(dev.name()), params: params, pages: pages, pageIndex: page };
}

function deviceRemotes() {
    return remotesOf(remotes, cursorDevice);
}

function deviceSetParam(args) {
    if (args.index == null) throw new Error("index required");
    remotes.getParameter(args.index).set(args.value);
    return { ok: true };
}

// ---------------------------------------------------------------------- clip

function clipCreate(args) {
    var slot = args.slot != null ? args.slot : 0;
    var len = args.length != null ? args.length : 4.0;
    cursorClipSlots.createEmptyClip(slot, len);
    cursorClipSlots.select(slot);
    return { ok: true, slot: slot, length: len };
}

function drumPadsList() {
    var out = [];
    var n = drumPads.getSizeOfBank();
    for (var i = 0; i < n; i++) {
        var nm = sget(drumPads.getItemAt(i).name());
        out.push({ pad: i, note: 36 + i, name: nm });
    }
    return out;
}

function clipWrite(args) {
    if (args.step == null || args.y == null) throw new Error("step and y required");
    var vel = args.velocity != null ? args.velocity : 100;
    var len = args.length != null ? args.length : 0.25;
    cursorClip.setStep(args.step, args.y, vel, len);
    return { ok: true };
}

// ------------------------------------------------------------------ js probe

function jsEval(expr) {
    if (expr == null) throw new Error("expr required");
    var v = eval("(" + expr + ")");
    return describe(v);
}

function describe(v) {
    if (v === null || v === undefined) return { type: "" + v };
    var t = typeof v;
    if (t === "number" || t === "boolean" || t === "string") return { type: t, value: v };
    var out = { type: "object", str: str(v) };
    try { out.class = "" + v.getClass(); } catch (e) {}
    return out;
}
