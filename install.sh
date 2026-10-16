#!/usr/bin/env bash
# One-shot setup: install deps and drop the Bitwig control script in place.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> npm install"
npm install

BWDIR="${HOME}/Bitwig Studio/Controller Scripts/AgentBridge"
echo "==> installing controller script -> ${BWDIR}"
mkdir -p "$BWDIR"
cp -v bitwig/AgentBridge.control.js "$BWDIR/"

cat <<'EOF'

Done. Remaining (manual, once):
  1. Launch Bitwig.
  2. Settings -> Controllers -> Add Controller -> AgentBridge.
     - MIDI in  : Bitwig Agent
     - MIDI out : Bitwig Agent Reply
     (auto-discovery should pick these up; otherwise choose them by hand.)
  3. Start the daemon:   npm start        (or: node bin/bitwigd.mjs)
  4. Smoke test:         curl -s localhost:8765/health
                         curl -s localhost:8765/call -d '{"cmd":"ping"}'

For opencode, see README.md ("Wire it into opencode").
EOF
