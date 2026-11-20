# Migrating a stateful MCP server to the stateless spec (2026-07-28)

Checked on 2026-11-20 against `@modelcontextprotocol/sdk` 1.32.2 (v1, before) and
`@modelcontextprotocol/server` 2.4.0 (v2, after). Both code samples below were run.

## 0. What changed on the wire

| | 2025-11-25 and earlier | 2026-07-28 |
|---|---|---|
| First call | `initialize` + `notifications/initialized` | none (optional `server/discover`) |
| Session | `Mcp-Session-Id` header, state in server memory | none |
| Who the client is | sent once, in `initialize` | in every request's `params._meta`: `io.modelcontextprotocol/protocolVersion`, `…/clientInfo`, `…/clientCapabilities` (all 3 are **required**) |
| Routing headers | `MCP-Protocol-Version` | plus `Mcp-Method` and `Mcp-Name`; a header/body mismatch → `400` / `-32020` |
| Server→client requests (sampling, elicitation, roots) | sent over the open session stream | the server returns `resultType: "input_required"`, and the client calls again with the answers (MRTR, SEP-2322) |
| Notifications | `GET /mcp` SSE stream | `subscriptions/listen`; `GET /mcp` returns `405` |
| Long jobs | Tasks (experimental) | `io.modelcontextprotocol/tasks` extension, polled with `tasks/get` |

## 1. Take stock: what does your server keep per session?

Search for these, because each one needs a new home:

- **Application state in memory per session** (a cart, a review being written, an open DB cursor) →
  step 2.
- **`server.server.createMessage` / `elicitInput` / `listRoots`** (server-initiated requests) → step 4.
- **`sendResourceUpdated`, `sendToolListChanged`, logging notifications, an `EventStore` for resumability** → step 4.
- **`sessionIdGenerator: () => randomUUID()`** and a `transports[sessionId]` map → step 3 removes it.

If your v1 server already used `sessionIdGenerator: undefined` (v1's stateless mode) and keeps no
per-session state, steps 1–2 are already done: go to step 3.

## 2. Move state out of memory: return an ID and pass it back

Before: `session.review = {...}`. After: the tool saves to a database and returns an ID; later tools
take that ID as an ordinary argument (`start_review → {review_id}`, `add_comment(review_id, …)`).
Because any user can now send any ID, **check on every call that the caller owns that ID**.

## 3. Upgrade the SDK and drop the session plumbing (TypeScript)

**Before** (`@modelcontextprotocol/sdk` 1.x, stateful):

```ts
const transports = {};                                    // sessionId -> transport, this process only
app.post('/mcp', async (req, res) => {
  let transport = transports[req.headers['mcp-session-id']];
  if (!transport && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => { transports[id] = transport; },
    });
    const server = new McpServer({ name: 'review-server', version: '1.0.0' });
    server.registerTool('add_comment', { inputSchema: { review_id: z.string(), line: z.number() } }, handler);
    await server.connect(transport);
  } else if (!transport) {
    return res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid session ID' }, id: null });
  }
  await transport.handleRequest(req, res, req.body);
});
```

**After** (`@modelcontextprotocol/server` 2.x, stateless):

```ts
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';   // not needed on Workers/Deno/Bun: use handler.fetch
import * as z from 'zod';

const factory = () => {                                        // called once per request
  const server = new McpServer({ name: 'review-server', version: '2.0.0' });
  server.registerTool('add_comment',
    { inputSchema: z.object({ review_id: z.string(), line: z.number() }) }, handler);
  return server;
};
http.createServer(toNodeHandler(createMcpHandler(factory))).listen(3000);
```

What goes away: the transport map, `isInitializeRequest`, `sessionIdGenerator`, cleanup on close.
Other differences: packages split into `@modelcontextprotocol/server` / `client` / `node` / `express` /
`hono`, and `inputSchema` is now a full `z.object(...)` rather than a plain object of fields. There is a
codemod, `npx @modelcontextprotocol/codemod@latest v1-to-v2 .` (I have not run it; review its diff). Full
guide: <https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2>.

**Python:** `mcp` 2.x on PyPI (2.3.0 today) supports 2026-07-28. I have not tested the Python migration.

## 4. Replace server-initiated requests and streams

- **Sampling / elicitation / roots:** in a stateless server there's no open channel to call the client
  on. Return an `input_required` result and let the client call again with the answers (MRTR). Sampling,
  Roots and Logging are also **deprecated** (SEP-2577) and kept for at least 12 months: call your LLM
  provider directly, take paths as tool arguments, and send logs to stderr or OpenTelemetry.
- **Change notifications:** clients subscribe through `subscriptions/listen`; drop your `GET` SSE
  handler and any resumability `EventStore`.
- **Long-running tools:** return a task and let the client poll `tasks/get`; on serverless, do the work
  in a queue worker, not in the request.

## 5. Keep old clients working while you roll out

`createMcpHandler` serves 2025-era clients by default (`legacy: 'stateless'`): an old client's
`initialize` gets a normal answer, **without** an `Mcp-Session-Id`, and later calls are served one at a
time. That's fine for clients that only call tools. If old clients rely on a real session
(sampling, subscriptions), keep your v1 wiring for them and route by era:

```ts
import { createMcpHandler, isLegacyRequest } from '@modelcontextprotocol/server';
const modern = createMcpHandler(factory, { legacy: 'reject' });
export default {
  async fetch(request) {
    if (await isLegacyRequest(request)) return myExistingLegacyHandler(request);  // old sessionful path
    return modern.fetch(request);
  },
};
```

The other direction: a client that speaks **only** 2026-07-28 cannot talk to an old v1 server. The v2 SDK
is built for clients that try `server/discover` and fall back to `initialize`. Still, upgrade servers
before clients.

## 6. Then simplify the infrastructure

1. Watch for legacy traffic (`isLegacyRequest`, or requests without `Mcp-Method`) to drop to near zero.
2. Remove sticky sessions (cookie or `Mcp-Session-Id` hashing) from NGINX/Envoy/ALB/Ingress.
3. Decommission the Redis **session** store. Keep a database for **application** state and tasks.
4. Optionally route or rate-limit at the gateway on `Mcp-Method` / `Mcp-Name` without parsing bodies.
5. Now the server can move to functions (Workers, Lambda, Cloud Run) and scale to zero.

## Sources

- Release post: <https://blog.modelcontextprotocol.io/posts/2026-07-28/>
- Spec: <https://modelcontextprotocol.io/specification/2026-07-28>
- AAIF migration walkthrough: <https://aaif.io/blog/migrate-sessions-to-stateless-requests-with-mcp-2026-07-28>
- Google Developers: <https://developers.googleblog.com/scaling-ai-agent-infrastructure-with-the-mcp-stateless-updates/>
  (note: it writes `inputRequired`; the spec and SDK use `input_required`)
