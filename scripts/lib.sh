#!/usr/bin/env bash
# Shared helper: one stateless MCP tool call (spec 2026-07-28) with plain curl.
# No initialize, no session ID: every request carries everything it needs.

MCP_URL="${MCP_URL:-http://localhost:8787/mcp}"

# mcp_call TOOL 'JSON-ARGS'  -> prints the tool's JSON result text
mcp_call() {
  local tool="$1" args="${2:-{\}}"
  local body
  body=$(jq -nc --arg tool "$tool" --argjson args "$args" '{
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: {
      name: $tool, arguments: $args,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "demo-curl", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }')
  curl -sS "$MCP_URL" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "MCP-Protocol-Version: 2026-07-28" \
    -H "Mcp-Method: tools/call" \
    -H "Mcp-Name: $tool" \
    -d "$body" |
    jq -r 'if .error then "ERROR: \(.error.message)"
           elif .result.isError then "TOOL ERROR: \(.result.content[0].text)"
           else .result.content[0].text end'
}
