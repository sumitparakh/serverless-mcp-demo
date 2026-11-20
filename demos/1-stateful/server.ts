// Demo 1: a STATEFUL MCP server, the way remote servers worked up to spec 2025-11-25.
// Usage: node server.ts <instance name> <port>
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
const [name, port] = [process.argv[2], Number(process.argv[3])];

type Review = { pr: number; comments: { line: number; text: string }[] };
type Session = { review?: Review };

// Sessions live in THIS process's memory. Other instances can't see them, and a restart wipes them.
const sessions = new Map<string, Session>();

const tools: Record<string, (session: Session, args: any) => string> = {
  start_review: (session, { pr }: { pr: number }) => {
    session.review = { pr, comments: [] };
    return `review of PR #${pr} started`;
  },
  add_comment: (session, { line, text }: { line: number; text: string }) => {
    session.review!.comments.push({ line, text });
    return `comment on line ${line} added (${session.review!.comments.length} so far)`;
  },
};

http.createServer(async (req, res) => {
  const msg = JSON.parse(await readBody(req));

  // Step 1: the handshake. Create a session and send its ID back in a header.
  if (msg.method === 'initialize') {
    const sessionId = randomUUID();
    sessions.set(sessionId, {});
    log(`initialize -> new session ${short(sessionId)}`);
    return send(res, 200, {
      jsonrpc: '2.0', id: msg.id,
      result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'review-server', version: '1.0' } },
    }, { 'Mcp-Session-Id': sessionId });
  }

  // Step 2: every later request must carry a session ID that THIS instance knows.
  const sessionId = String(req.headers['mcp-session-id']);
  const session = sessions.get(sessionId);
  if (!session) {
    log(`x unknown session ${short(sessionId)}`);
    return send(res, 404, { jsonrpc: '2.0', id: msg.id, error: { code: -32001, message: 'Session not found' } });
  }

  // Step 3: run the tool against the state kept in memory.
  const text = tools[msg.params.name](session, msg.params.arguments);
  log(`${msg.params.name}: ${text}`);
  send(res, 200, { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `[instance ${name}] ${text}` }] } });
}).listen(port, () => log(`listening on :${port}`));

// Helpers
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
}
function send(res: ServerResponse, status: number, body: object, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}
function log(line: string) { console.log(`[instance ${name}] ${line}`); }
function short(id: string) { return id.slice(0, 8); }
