// MCP server exposing the Bitwig bridge to opencode (stdio transport).
// It is a thin client over the bitwigd HTTP API so a single process owns the
// MIDI ports.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DAEMON = process.env.BITWIGD_URL || "http://127.0.0.1:8765";

async function call(cmd, args = {}) {
  const res = await fetch(DAEMON + "/call", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cmd, args }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || "bitwig error");
  return body.result;
}

function txt(v) {
  return { content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] };
}

const server = new McpServer({ name: "bitwig", version: "0.1.0" });

server.registerTool(
  "bitwig_ping",
  {
    title: "Ping the Bitwig bridge",
    description:
      "Verify the bridge is reachable and Bitwig is answering. Returns bridge version and host API version. " +
      "If this times out, Bitwig isn't running or the AgentBridge controller isn't enabled/connected.",
    inputSchema: {},
  },
  async () => txt(await call("ping")),
);

server.registerTool(
  "bitwig_call",
  {
    title: "Raw Bitwig command",
    description:
      "Low-level escape hatch: send any command from the bridge command set directly. Use this for anything " +
      "not yet wrapped by a named tool. See the project README for the command list.",
    inputSchema: {
      cmd: z.string().describe("Command name, e.g. 'transport.get' or 'track.list'."),
      args: z.record(z.any()).optional().describe("Command arguments object."),
    },
  },
  async ({ cmd, args }) => txt(await call(cmd, args || {})),
);

server.registerTool(
  "bitwig_transport",
  {
    title: "Bitwig transport",
    description: "Control the transport. action: get | play | stop | restart | record | set_tempo | set_position | toggle_loop.",
    inputSchema: {
      action: z.string(),
      value: z.number().optional().describe("For set_tempo (BPM) / set_position."),
    },
  },
  async ({ action, value }) => txt(await call("transport." + action, value != null ? { value } : {})),
);

server.registerTool(
  "bitwig_tracks",
  {
    title: "Bitwig tracks",
    description:
      "Inspect and modify tracks. action: list | select | set. For 'set' pass index plus one of " +
      "name/mute/solo/arm/volume/pan as field+value.",
    inputSchema: {
      action: z.string(),
      index: z.number().int().optional(),
      field: z.string().optional(),
      value: z.any().optional(),
    },
  },
  async ({ action, index, field, value }) => {
    const args = {};
    if (index != null) args.index = index;
    if (field) args[field] = value;
    return txt(await call("track." + action, args));
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
