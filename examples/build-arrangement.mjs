// One-off: expand the techno beat into a sectioned arrangement (scene-based).
const B = "http://127.0.0.1:8765/call";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(cmd, args = {}) {
  const r = await fetch(B, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd, args }) });
  const j = await r.json();
  if (!j.ok) throw new Error(`${cmd}: ${j.error}`);
  return j.result;
}
const js = (expr) => call("js", { expr });

const P = "/opt/bitwig-studio/Library/devices";
const TRACKS = ["Kick", "Clap", "Hat", "Bass", "Hook"];
const PITCHED = { Bass: 1, Hook: 1 };

// 1-bar patterns: [step, pitch, velocity]
const PAT = {
  kick: [[0, 0, 120], [4, 0, 120], [8, 0, 120], [12, 0, 120]],
  clap: [[4, 0, 105], [12, 0, 105]],
  hat: [[2, 0, 85], [6, 0, 85], [10, 0, 85], [14, 0, 85]],
  hat16: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((s) => [s, 0, s % 2 ? 55 : 95]),
  bass: [[0, 33, 110], [2, 33, 95], [4, 33, 105], [5, 45, 85], [6, 33, 95], [8, 33, 110], [10, 33, 95], [12, 33, 105], [13, 45, 85], [14, 33, 95]],
  hook: [[0, 69, 100], [3, 72, 90], [6, 76, 100], [8, 72, 85], [11, 69, 95], [14, 74, 90]],
};

const SECTIONS = [
  { name: "Intro",     on: { Hat: "hat", Hook: "hook" } },
  { name: "Build",     on: { Kick: "kick", Hat: "hat", Bass: "bass" } },
  { name: "Drop",      on: { Kick: "kick", Clap: "clap", Hat: "hat", Bass: "bass", Hook: "hook" } },
  { name: "Breakdown", on: { Bass: "bass", Hook: "hook" } },
  { name: "Buildup",   on: { Kick: "kick", Hat: "hat16", Bass: "bass" } },
  { name: "Outro",     on: { Hat: "hat", Hook: "hook" } },
];

(async () => {
  await js("application.createInstrumentTrack(3)");
  await call("device.insert", { index: 3, path: `${P}/Polysynth.bwdevice` });
  await call("track.set", { index: 3, name: "Bass" });
  await js("application.createInstrumentTrack(4)");
  await call("device.insert", { index: 4, path: `${P}/Polysynth.bwdevice` });
  await call("track.set", { index: 4, name: "Hook" });
  await sleep(700);
  console.log("tracks:", (await call("track.list")).slice(0, 5).map((t) => `${t.index}:${t.name}`).join("  "));

  for (let ti = 0; ti < TRACKS.length; ti++) {
    await call("track.select", { index: ti });
    await sleep(550);
    for (let r = 0; r < SECTIONS.length; r++) {
      await call("clip.create", { slot: r, length: 4 });
      await sleep(500);
      const on = SECTIONS[r].on[TRACKS[ti]];
      if (on) {
        for (const [s, p, v] of PAT[on]) {
          await call("clip.write", { step: s, y: PITCHED[TRACKS[ti]] ? p : 36, velocity: v, length: 0.22 });
        }
      }
      await sleep(250);
    }
    console.log(`  built ${TRACKS[ti]} across ${SECTIONS.length} sections`);
  }
  console.log("scenes:", (await call("scene.list")).length);
  console.log("done");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
