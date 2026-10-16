#!/usr/bin/env node
// bitwigd: opens the virtual MIDI ports and serves the local HTTP/WS API.

import { BitwigBridge } from "../src/bridge.mjs";
import { startDaemon } from "../src/daemon.mjs";

const port = Number(process.env.BITWIGD_PORT || 8765);
const host = process.env.BITWIGD_HOST || "127.0.0.1";

const bridge = new BitwigBridge();
bridge.open();

if (bridge.mode === "device") {
  console.log(`[bitwigd] attached to ALSA rawmidi device: "${bridge.portName}"`);
  console.log(`[bitwigd]   -> in Bitwig set the AgentBridge controller's`);
  console.log(`[bitwigd]      MIDI in  = "${bridge.portName}"`);
  console.log(`[bitwigd]      MIDI out = "${bridge.portName}"`);
} else {
  console.warn(`[bitwigd] WARNING: no rawmidi device found (looked for /${bridge.portPattern}/i).`);
  console.warn(`[bitwigd] Falling back to ALSA *sequencer* virtual ports, which Bitwig CANNOT see.`);
  console.warn(`[bitwigd] Fix: load the virtual rawmidi module, then restart bitwigd:`);
  console.warn(`[bitwigd]   sudo modprobe snd-virmidi`);
  console.warn(`[bitwigd]   echo snd-virmidi | sudo tee /etc/modules-load.d/snd-virmidi.conf`);
  console.warn(`[bitwigd] opened virtual ports: "${bridge.cmdOutName}" / "${bridge.replyInName}"`);
}

bridge.on("event", (e) => console.error("[bitwigd] event", JSON.stringify(e)));

const server = startDaemon({ port, host, bridge });
console.log(`[bitwigd] HTTP API: http://${host}:${port}   (GET /health, POST /call, WS /events)`);
console.log(`[bitwigd] point opencode's bitwig MCP server here via BITWIGD_URL`);

function shutdown() {
  console.log("\n[bitwigd] shutting down");
  try { bridge.close(); } catch {}
  try { server.close(); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
