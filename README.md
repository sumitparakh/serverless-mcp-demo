# Serverless MCP demo: Priya's order-support server

A stateless MCP server (spec **2026-07-28**) on **Cloudflare Workers**, from the talk
*Serverless MCP servers, from laptop to production*.

- **No session.** `createMcpHandler` builds a fresh MCP server for every request.
- **State lives in D1** (the "Returns DB" on the slides), behind IDs like `r_42` that the model keeps.
- **Any copy of the Worker can answer any request**, so it scales out and back to zero on its own.
- Older (2025-era) clients that still send `initialize` are served too.

## Tools

| Tool | What it does | Pattern from the talk |
|---|---|---|
| `get_order` | Order status and items | Customer comes from the server, never from a tool argument |
| `start_return` | Starts a return, returns `return_id` | Explicit ID instead of a session |
| `add_item` | Adds a SKU to a return | Ownership checked on every call; clear, fixable errors |
| `get_return` | Shows a return and its items | Read-only |
| `issue_refund` | Refunds the items in a return | Idempotency key: a retry never refunds twice |

Every result includes `served_by`, a random ID for the Worker copy (isolate) that handled it.

> **Demo shortcut:** there is no login, so every call acts as the customer `priya`.
> In production, put OAuth in front and take the customer from the token
> (for example with Cloudflare's `@cloudflare/workers-oauth-provider` library).

## Run locally

Requires Node 20+ and `jq`.

```bash
npm install
npm run db:local        # create tables and demo data in a local D1 database
npm run dev             # http://localhost:8787/mcp
```

In a second terminal:

```bash
scripts/one-request.sh  # one raw curl: no initialize, no session
scripts/priya-story.sh  # the whole return, step by step
scripts/burst.sh        # 50 requests at once
```

## Deploy to Cloudflare

```bash
npx wrangler login
npx wrangler d1 create order-support      # copy the database_id it prints...
#   ...into wrangler.jsonc, replacing 00000000-0000-0000-0000-000000000000
npm run db:remote                         # create tables and demo data in D1
npm run deploy                            # prints https://order-support-mcp.<you>.workers.dev
```

Then point the scripts at it:

```bash
export MCP_URL=https://order-support-mcp.<you>.workers.dev/mcp
scripts/one-request.sh
scripts/burst.sh "$MCP_URL" 50
```

## Use it in Claude

In Claude (web or desktop), open **Connectors** (under Settings or Customize, depending on
the app version), choose **Add custom connector**, paste the
`https://…workers.dev/mcp` URL, then ask: *"Where is order 1042? I'd like to return the T-shirt."*

## Demo runbook (5 minutes)

**Before the talk**
1. Deploy (steps above) and run all three scripts against the deployed URL once.
2. Add the custom connector in Claude and run the prompt once.
3. Record a screen capture of steps 1–4 below as a backup.
4. Terminal: large font, `export MCP_URL=…` already set, the commands in shell history.

**On stage**
1. **Deployed:** show `src/index.ts` (the `createMcpHandler(() => createServer(env))` line)
   and the `npm run deploy` output.
2. **One request:** `scripts/one-request.sh`. Point out the headers and that there is no
   `initialize` and no `Mcp-Session-Id`.
3. **Fifty at once:** `scripts/burst.sh`. 50/50 succeed. On the deployed Worker, `served_by`
   often shows more than one copy; locally there is only one.
4. **In Claude:** ask about order 1042 and the return.

If any step stalls for more than 30 seconds, switch to the recording.

## What a 2026-07-28 request looks like

```http
POST /mcp
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: get_order

{"jsonrpc":"2.0","id":1,"method":"tools/call",
 "params":{"name":"get_order","arguments":{"order_id":"1042"},
   "_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28",
            "io.modelcontextprotocol/clientInfo":{"name":"demo-curl","version":"1.0.0"},
            "io.modelcontextprotocol/clientCapabilities":{}}}}
```

All three `_meta` keys are required; leave out `clientCapabilities` and the server answers
`-32602 Invalid _meta envelope`. `GET /mcp` returns `405`: there is no long-lived stream.

## Versions tested

`agents` 0.33.0, `@modelcontextprotocol/server` 2.4.0, `zod` 4.6.7, `wrangler` 4.165.0, Node 22.
