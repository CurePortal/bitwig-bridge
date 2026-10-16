// Properly CLEAR hook clips before writing the sparse melody (no accumulation).
const B = "http://127.0.0.1:8765/call";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(cmd, args = {}) {
  const r = await fetch(B, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd, args }) });
  const j = await r.json();
  if (!j.ok) throw new Error(`${cmd}: ${j.error}`);
  return j.result;
}
const HOOK = 4;
const MEL = [[2, 69, 105], [6, 72, 95], [10, 76, 110], [14, 72, 95]];
const HOOK_ROWS = [0, 2, 3, 5];
(async () => {
  await call("track.select", { index: HOOK });
  await sleep(600);
  for (let r = 0; r < 6; r++) {
    await call("clip.create", { slot: r, length: 4 });   // ensure a clip exists in this row
    await sleep(500);
    await call("clip.clear");                              // <-- wipe the cursor clip first
    await sleep(350);
    if (HOOK_ROWS.includes(r)) for (const [s, p, v] of MEL) await call("clip.write", { step: s, y: p, velocity: v, length: 0.22 });
    await sleep(250);
    console.log(`  hook row ${r}: cleared${HOOK_ROWS.includes(r) ? " + wrote 4 notes" : " (kept empty)"}`);
  }
  console.log("done");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
