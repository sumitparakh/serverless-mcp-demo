#!/usr/bin/env bash
# Demo step 2: ONE raw request. Shown on screen as-is so the audience sees there is
# no initialize and no Mcp-Session-Id header. Usage: scripts/one-request.sh [URL]
set -euo pipefail
URL="${1:-${MCP_URL:-http://localhost:8787/mcp}}"

set -x
curl -sS "$URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: tools/call" \
  -H "Mcp-Name: get_order" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"get_order","arguments":{"order_id":"1042"},
         "_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28",
                  "io.modelcontextprotocol/clientInfo":{"name":"demo-curl","version":"1.0.0"},
                  "io.modelcontextprotocol/clientCapabilities":{}}}}' |
  { set +x; jq -r 'if .error then "ERROR: \(.error.message)" else .result.content[0].text end'; }
