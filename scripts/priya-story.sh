#!/usr/bin/env bash
# The whole story from the slides: each step is an independent request.
# The only thing that links them is the return ID (r_...) that we, the client, keep.
# Usage: scripts/priya-story.sh [URL]
set -euo pipefail
cd "$(dirname "$0")"
MCP_URL="${1:-${MCP_URL:-http://localhost:8787/mcp}}"
source ./lib.sh

step() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }

step "Priya: where is order 1042?"
mcp_call get_order '{"order_id":"1042"}'

step "Start a return. The server hands back an ID; the client keeps it."
out=$(mcp_call start_return '{"order_id":"1042"}'); echo "$out"
RID=$(jq -r .return_id <<<"$out")

step "Add the T-shirt, passing $RID (any instance can serve this)"
mcp_call add_item "{\"return_id\":\"$RID\",\"sku\":\"TSHIRT-M\"}"

step "Try to add an item that is not in the order: a clear error the model can act on"
mcp_call add_item "{\"return_id\":\"$RID\",\"sku\":\"HOODIE-S\"}"

step "Check the return"
mcp_call get_return "{\"return_id\":\"$RID\"}"

KEY=$(uuidgen)
step "Refund it with idempotency key ${KEY:0:8}…"
mcp_call issue_refund "{\"return_id\":\"$RID\",\"idempotency_key\":\"$KEY\"}"

step "The client retries with the SAME key (say, after a dropped connection): no second refund"
mcp_call issue_refund "{\"return_id\":\"$RID\",\"idempotency_key\":\"$KEY\"}"

step "Someone else's order (2001) is invisible to Priya"
mcp_call get_order '{"order_id":"2001"}'
