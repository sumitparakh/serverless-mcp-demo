#!/usr/bin/env bash
# Demo 1: a stateful MCP server works on one instance and breaks behind a load balancer.
# Press Enter to move to the next step. NOPAUSE=1 runs it straight through.
cd "$(dirname "$0")"
trap 'kill $(jobs -p) 2>/dev/null' EXIT
node server.ts A 3001 & node server.ts B 3002 & node ../lb.ts & sleep 1

step() { echo; echo "=== $1"; [ -n "$NOPAUSE" ] || read -r; }
call() { # call <port> <tool> <arguments as JSON>
  curl -s -w "   <- HTTP %{http_code}\n" "localhost:$1/mcp" -H 'Content-Type: application/json' \
    -H "Mcp-Session-Id: $SESSION" -H 'MCP-Protocol-Version: 2025-11-25' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$2\",\"arguments\":$3}}"
}

step "1. Handshake with instance A: it creates a session and returns the ID in a header"
SESSION=$(curl -s -D - -o /dev/null localhost:3001/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"claude","version":"1"}}}' \
  | awk 'tolower($1)=="mcp-session-id:" {print $2}' | tr -d '\r')
echo "   Mcp-Session-Id: $SESSION"

step "2. Talk to instance A directly: everything works"
call 3001 start_review '{"pr":42}'
call 3001 add_comment '{"line":12,"text":"typo"}'

step "3. Scale out: the same calls go through the load balancer (A, B, A, B...)"
call 3000 add_comment '{"line":30,"text":"needs a test"}'
call 3000 add_comment '{"line":31,"text":"rename this"}'

step "4. Deploy a new version: restart instance A"
kill %1; wait %1 2>/dev/null; node server.ts A 3001 & sleep 1
call 3001 add_comment '{"line":40,"text":"nit"}'

step "Done. Fixes were sticky sessions or a shared Redis session store."
