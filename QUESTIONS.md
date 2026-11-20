# Likely audience questions, with short answers

For the talk *Serverless MCP servers, from laptop to production*. Answers are meant to be said in
about 30 seconds. ⚠️ marks an answer to check before relying on it.

## The example and the framing

**1. The local GitHub server calls the GitHub API too. Why is remote harder to scale?**
The API was always someone else's problem, and GitHub's API already serves millions of clients. What's new is
the MCP server in front of it. Locally, every user runs their own copy. Remotely, one fleet serves everyone, and
any state it keeps between requests decides how that fleet can scale.

**2. When should I build a local (stdio) server and when a remote one?**
Local when the tool needs the user's machine (files, local apps, a dev environment) or is for one person.
Remote when the data or credentials are central (a company database, a SaaS product), when users shouldn't
install anything, or when you need central auth, auditing and updates.

**3. Why not just give the agent a REST API / OpenAPI spec?**
MCP standardizes what agents need on top of HTTP: tool discovery with schemas, an OAuth flow clients
understand, long-running tasks, asking the user for input. With 2026-07-28 it's also much closer to plain
HTTP, which is the point of this talk.

## The spec change

**4. Couldn't you already run MCP stateless before July 2026?**
Yes. Sessions were optional, and the TypeScript SDK had `sessionIdGenerator: undefined`. But you gave up a lot:
- **Asking the client something mid-call** (sampling, elicitation): the client's answer came back as a new
  request, possibly to another instance that didn't have the call waiting for it.
- **The notification stream:** it belonged to a session, so it was gone.
- **Resuming a dropped stream:** also gone.
- **Knowing which client you're talking to:** capabilities were only sent once, in `initialize`.

2026-07-28 redesigned each of these so they work without a session.

**5. Without `initialize`, how does the server know what the client supports?**
Every request carries three required `_meta` keys: `io.modelcontextprotocol/protocolVersion`,
`…/clientInfo` and `…/clientCapabilities`. A client can call the optional `server/discover` to learn
the server's capabilities and supported versions.

**6. Isn't sending capabilities on every request wasteful?**
It's a few hundred bytes, similar to an HTTP header block. In exchange you skip the handshake round trip and
any instance can answer any request. That trade is worth it.

**7. Why put the method and tool name in headers when they're already in the body?**
So gateways, WAFs and load balancers can route, rate-limit or block per tool without parsing JSON. The
server must reject a mismatch between header and body (`400`, error `-32020`), so a header can't be used to
sneak a different call past a gateway.

**8. How does elicitation work with no open connection?**
Multi-round-trip requests (MRTR). The server returns `resultType: "input_required"` with its questions and a
`requestState`. The client asks the user, then calls again with the answers and the same `requestState`, so
any instance can continue. Since `requestState` passes through the client, **sign or encrypt it** if it holds
anything that matters.

**9. What about notifications like "the tool list changed"?**
The client opens a `subscriptions/listen` stream for the notification types it wants. The old `GET /mcp`
stream is gone (servers answer `405`). Tool and resource lists can also say how long a client may cache them
(`ttlMs`).

**10. Is anything deprecated?**
Roots, Sampling and Logging (SEP-2577), supported for at least 12 more months. The replacements: take paths as
tool arguments, call your LLM provider directly, and log to stderr or OpenTelemetry. Dynamic Client
Registration is deprecated in favour of Client ID Metadata Documents.

**11. Is it backward compatible?**
Not on the wire, but the v2 SDKs handle both. `createMcpHandler` serves 2025-era clients by default
(`legacy: 'stateless'`) and new clients with the new protocol. A client that speaks only 2026-07-28 can't talk
to a 2025-only server, so upgrade servers first.

**12. Do Claude and other clients support 2026-07-28 yet?** ⚠️
Check each client's release notes; this changes quickly. You don't have to wait: a v2 server serves old and
new clients at the same time.

## Where the state goes

**13. If the server keeps nothing, where does the state live?**
In a database, under an ID the tool returns (`rv_42`) and the model passes back as a normal argument. The state
didn't disappear; it moved out of server memory into a store that's built to be shared.

**14. Isn't the database now the bottleneck?**
It was always there: your application data lived in a database anyway. What goes away is the *extra* session
layer (sticky routing, a Redis session store). Databases replicate and scale in well-understood ways; session
affinity doesn't.

**15. What stops me from sending someone else's `review_id`?**
Nothing in the protocol, so the server must check on every call that the signed-in user owns that ID. Use
unguessable IDs as well, but don't rely on them for security.

**16. Some servers are truly stateful: a browser, a REPL, a database transaction. Now what?**
Keep the live resource somewhere addressable and route to it by ID: a Durable Object, a per-session container,
or a browser pool keyed by `browser_id`. The MCP layer stays stateless; only the resource is pinned. Or keep
that server local over stdio.

**17. Won't the model forget or make up the ID?**
Sometimes. Tool descriptions should say to reuse the ID, results should repeat it, and the server should answer
an unknown ID with a clear error the model can fix ("no review rv_99; call start_review first").

**18. What about retries?**
Clients retry when connections drop, and in 2026-07-28 a dropped stream can't be resumed, so the request is
sent again. A tool that creates or charges something needs an idempotency key so a retry doesn't do it twice.

## Serverless in practice

**19. Cold starts?**
Workers isolates start in milliseconds. Lambda takes from about 100 ms to over a second depending on runtime
and size, and provisioned concurrency removes it. Next to an LLM call that takes seconds, it's usually small.

**20. My tool takes five minutes. Functions time out.**
Return a task. Put the work on a queue, return a task ID right away, and let the client poll `tasks/get`
(Tasks is now the `io.modelcontextprotocol/tasks` extension).

**21. Database connections from thousands of short-lived functions?**
Use a pooler or an HTTP-based driver: RDS Proxy, Cloudflare Hyperdrive or D1, Neon's or PlanetScale's
serverless drivers. Don't open a raw TCP pool per invocation.

**22. Can I do this on Kubernetes instead?**
Yes. Stateless helps any horizontally scaled setup: plain round-robin, no session affinity, rolling deploys
without dropping users, and autoscaling on CPU or requests. Serverless is one option, not a requirement.

**23. How do I rate-limit per user without sessions?**
By the identity in the access token (its `sub`), at the gateway. `Mcp-Name` lets you set different limits per
tool, such as a tight limit on `merge_pull_request`.

**24. How do I trace one agent conversation across many independent requests?**
Propagate W3C trace context on each request and tag spans with your own IDs (`review_id`, task ID). Since there's no
session ID, those IDs are your correlation keys.

**25. Is serverless actually cheaper?**
At low or spiky usage, usually: you pay nothing while idle, and agent traffic is spiky. For steady high
traffic, containers often win. Measure your own traffic.

## Auth and security

**26. How does auth work without a session?**
The same as any HTTP API: an OAuth 2.1 bearer token on every request, checked every time (cache the issuer's
keys). HTTP MCP already sent the token on every request, so this part barely changes.

**27. Should my server pass the user's token on to GitHub or another API?**
No. Token passthrough is on the OWASP MCP Top 10. Exchange it for a token meant for the downstream API, or
use the server's own credentials and enforce the user's permissions yourself.

**28. Does stateless make security better or worse?**
Mostly better: there's no session to hijack, and every request is fully authenticated. The new things to
protect are IDs (question 15) and `requestState` (question 8).

## Migration

**29. I have a v1 server in production. What's the smallest safe path?**
1. Move per-session data into a store, keyed by IDs passed as tool arguments.
2. Upgrade to the v2 SDK and use `createMcpHandler`; old clients keep working.
3. Once legacy traffic is near zero, remove sticky sessions and the Redis session store.

Details are in `demos/MIGRATION.md`.

**30. Python?** ⚠️
`mcp` 2.x on PyPI supports 2026-07-28 (2.3.0 at the time of writing). I haven't tested the Python migration
path myself.
