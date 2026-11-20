# Stateful vs stateless MCP: two live demos

Both servers speak raw JSON-RPC over HTTP with **no runtime dependencies**, written in TypeScript that Node 22.18+ runs directly (no build step; `npx tsc -p demos` type-checks), so every line on
screen is protocol, not framework. They tell the same story as slides 3–5: Claude reviewing PR #42.

| File | Lines | What to point at |
|---|---|---|
| `lb.ts` | ~15 | Round robin, **no sticky sessions**: like a serverless platform |
| `1-stateful/server.ts` | ~60 | `sessions = new Map()`, the `initialize` branch, the `404 Session not found` branch |
| `2-stateless/server.ts` | ~65 | No `initialize`; header checks; state in `db.json`, found by `review_id` |

## Run

```bash
cd demos
./1-stateful/demo.sh     # press Enter to go to each next step
./2-stateless/demo.sh
```

`NOPAUSE=1 ./1-stateful/demo.sh` runs a step without pausing (for rehearsal). Each script starts
instances A (:3001) and B (:3002) and the load balancer (:3000), and stops them all when it exits.

## Demo 1: stateful (about 4 minutes)

| Step | You'll see | Say |
|---|---|---|
| 1 Handshake with A | `Mcp-Session-Id: 357d…` | "The client's first call opens a session. A keeps it **in memory**." |
| 2 Talk to A directly | two `200`s | "One server: works fine. This is every MCP tutorial before July." |
| 3 Through the load balancer | `200` from A, then **`404 Session not found`** from B | "B has never heard of this session." |
| 4 Restart A | **`404`** from A itself | "A deploy wiped the review. The user's work is gone." |

Close with: the usual fixes were sticky sessions or a Redis session store, and neither suits functions
that start and stop all the time.

## Demo 2: stateless (about 4 minutes)

Before running, show `diff`-style what changed: the `initialize` branch and the `Map` are gone; the tool
returns a `review_id`, and the client passes it back as an ordinary argument.

| Step | You'll see | Say |
|---|---|---|
| 1 `start_review` via LB | `{"review_id":"rv_42"}` from A | "No handshake. The request carries version, client info and capabilities in `_meta`." |
| 2 Two comments via LB | B, then A: both `200` | "Different instances, same review: it's in the database." |
| 3 Restart **both** instances | full review comes back | "Deploys lose nothing, because no instance held anything." |
| 4 50 requests at once | `50 HTTP 200` | "This is what lets a serverless platform scale you out and back to zero." |

Then switch to the Cloudflare Worker in the repo root (`scripts/burst.sh` against the deployed URL) to show
the same thing for real.

## What is simplified (be ready if asked)

- **Real transport details skipped:** no `Accept` header handling, no SSE responses, no `notifications/initialized`,
  no `tools/list`, no input validation. The real SDKs do all of that; the wire shapes here match the
  2026-07-28 spec and were checked against `@modelcontextprotocol/server` 2.4.0.
- **The "database" is a JSON file** shared by two local processes. In production: D1, DynamoDB, Postgres.
- **`server/discover`** (optional capability discovery in 2026-07-28) is not implemented.
- Unknown session → `404` and missing session → `400` follow the 2025-11-25 spec.
