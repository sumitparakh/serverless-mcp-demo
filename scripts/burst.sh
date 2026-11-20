#!/usr/bin/env bash
# Demo step 3: fire N requests at once. With no sessions, every one succeeds,
# whichever copy of the Worker picks it up. Usage: scripts/burst.sh [URL] [N]
set -euo pipefail
cd "$(dirname "$0")"
MCP_URL="${1:-${MCP_URL:-http://localhost:8787/mcp}}"
N="${2:-50}"
source ./lib.sh
export MCP_URL
export -f mcp_call

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
start=$(date +%s)
for i in $(seq 1 "$N"); do
  ( mcp_call get_order '{"order_id":"1042"}' > "$tmp/$i" 2>&1 ) &
done
wait
secs=$(( $(date +%s) - start ))

ok=$(grep -l '"served_by"' "$tmp"/* | wc -l | tr -d ' ')
echo "Requests:  $N sent at once, finished in about ${secs}s"
echo "Succeeded: $ok / $N"
echo "Served by these Worker copies (isolates):"
cat "$tmp"/* | jq -r 'select(.served_by) | .served_by' 2>/dev/null | sort | uniq -c | sort -rn
