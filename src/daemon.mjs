// Local HTTP + WebSocket API in front of the MIDI bridge.
//
//   GET  /health          -> { ok, connected, lastSeen }
//   POST /call            -> { ok, result } | { ok:false, error }   body: {cmd,args}
//   WS   /events          -> streams unsolicited events from Bitwig

import http from "node:http";
import { WebSocketServer } from "ws";

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(body);
}

export function startDaemon({ port = 8765, host = "127.0.0.1", bridge } = {}) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true, connected: bridge.connected, lastSeen: bridge.lastSeen });
    }
    if (req.method === "POST" && req.url === "/call") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const { cmd, args } = JSON.parse(body || "{}");
          if (!cmd) throw new Error("cmd required");
          const result = await bridge.call(cmd, args || {});
          json(res, 200, { ok: true, result });
        } catch (e) {
          json(res, 200, { ok: false, error: String(e.message || e) });
        }
      });
      return;
    }
    json(res, 404, { ok: false, error: "not found" });
  });

  const wss = new WebSocketServer({ server, path: "/events" });
  bridge.on("event", (ev) => {
    const payload = JSON.stringify(ev);
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(payload);
    }
  });

  server.listen(port, host);
  return server;
}
