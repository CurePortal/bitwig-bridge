// Growl bass: thicken synth (sub + unison), drive the distortion, hit hard, driving pattern.
const B = "http://127.0.0.1:8765/call";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(cmd, args = {}) {
  const r = await fetch(B, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd, args }) });
  const j = await r.json();
  if (!j.ok) throw new Error(`${cmd}: ${j.error}`);
  return j.result;
}
const js = (e) => call("js", { expr: e });
const GROWL = 5;
// driving A-minor bassline (A1=33, octave up accent A2=45)
const PAT = [[0, 33, 127], [2, 33, 100], [4, 33, 115], [6, 33, 100], [8, 33, 127], [10, 33, 100], [12, 33, 115], [14, 45, 110]];
const ROWS = [1, 2, 3, 4]; // Build, Drop, Breakdown, Buildup

(async () => {
  await call("track.select", { index: GROWL });
  await sleep(600);
  // cursor device = Polysynth -> OSC1 page: Sub1 (idx6), Uni1 (idx2)
  await call("device.set_param", { index: 6, value: 0.65 }); // sub osc
  await call("device.set_param", { index: 2, value: 0.45 }); // unison detune (reese)
  await js("cursorDevice.selectNext()"); await sleep(400); // -> Distortion
  await call("device.set_param", { index: 0, value: 0.72 }); // Drive
  await call("device.set_param", { index: 5, value: 0.9 });  // Gain
  await call("track.set", { index: GROWL, volume: 0.95 });
  console.log("synth+distortion set");
  for (let r = 0; r < 6; r++) {
    await call("clip.create", { slot: r, length: 4 }); await sleep(500);
    await call("clip.clear"); await sleep(300);
    if (ROWS.includes(r)) for (const [s, p, v] of PAT) await call("clip.write", { step: s, y: p, velocity: v, length: 0.2 });
    await sleep(200);
  }
  console.log("growl pattern written to rows", ROWS.join(","));
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
