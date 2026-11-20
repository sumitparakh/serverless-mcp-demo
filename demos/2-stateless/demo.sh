#!/usr/bin/env bash
# Demo 2: a stateless MCP server works on any instance, and survives restarts.
# Press Enter to move to the next step. NOPAUSE=1 runs it straight through.
cd "$(dirname "$0")"
rm -f db.json
trap 'kill $(jobs -p) 2>/dev/null' EXIT
node server.ts A 3001 & node server.ts B 3002 & node ../lb.ts & sleep 1

step() { echo; echo "=== $1"; [ -n "$NOPAUSE" ] || read -r; }
call() { # call <tool> <arguments as JSON>   (always through the load balancer)
  curl -s -w "   <- HTTP %{http_code}\n" localhost:3000/mcp -H 'Content-Type: application/json' \
    -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: tools/call' -H "Mcp-Name: $1" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2,
         \"_meta\":{\"io.modelcontextprotocol/protocolVersion\":\"2026-07-28\",
                    \"io.modelcontextprotocol/clientInfo\":{\"name\":\"claude\",\"version\":\"1\"},
                    \"io.modelcontextprotocol/clientCapabilities\":{}}}}"
}

step "1. No handshake. Start a review through the load balancer and get back an ID"
call start_review '{"pr":42}'

step "2. Add comments: they land on different instances, and both work"
call add_comment '{"review_id":"rv_42","line":12,"text":"typo"}'
call add_comment '{"review_id":"rv_42","line":30,"text":"needs a test"}'

step "3. Deploy a new version: restart BOTH instances"
kill %1 %2; wait %1 %2 2>/dev/null; node server.ts A 3001 & node server.ts B 3002 & sleep 1
call get_review '{"review_id":"rv_42"}'

step "4. Burst: 50 requests at once, spread over both instances"
for i in $(seq 50); do call get_review '{"review_id":"rv_42"}' & done 2>/dev/null | grep -o 'HTTP [0-9]*' | sort | uniq -c

step "Done. Nothing to pin, nothing to share but the database."
