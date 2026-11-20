// Demo 2: a STATELESS MCP server, the way spec 2026-07-28 works.
// Usage: node server.ts <instance name> <port>
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
const [name, port] = [process.argv[2], Number(process.argv[3])];

type Review = { pr: number; comments: { line: number; text: string }[] };

// The "database": one JSON file that every instance shares.
// In production this is DynamoDB, Postgres, Cloudflare KV, and so on.
const DB = new URL('db.json', import.meta.url);
const readDb = (): Record<string, Review> => (fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, 'utf8')) : {});
const dbGet = (id: string) => readDb()[id];
const dbSet = (id: string, value: Review) => fs.writeFileSync(DB, JSON.stringify({ ...readDb(), [id]: value }, null, 2));

// The review's ID travels in the tool arguments, not in a session.
const tools: Record<string, (args: any) => object> = {
  start_review: ({ pr }: { pr: number }) => {
    const review_id = `rv_${pr}`;
    dbSet(review_id, { pr, comments: [] });
    return { review_id };
  },
  add_comment: ({ review_id, line, text }: { review_id: string; line: number; text: string }) => {
    const review = dbGet(review_id);
    review.comments.push({ line, text });
    dbSet(review_id, review);
    return { review_id, comments: review.comments.length };
  },
  get_review: ({ review_id }: { review_id: string }) => dbGet(review_id),
};

http.createServer(async (req, res) => {
  const msg = JSON.parse(await readBody(req));

  // Step 1: no handshake and no session. Each request says who it is and which version it speaks.
  if (req.headers['mcp-protocol-version'] !== '2026-07-28') {
    return send(res, 400, { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'This server speaks 2026-07-28 only' } });
  }
  // The method is also in a header, so a gateway can route or rate-limit without reading the body.
  if (req.headers['mcp-method'] !== msg.method) {
    return send(res, 400, { jsonrpc: '2.0', id: msg.id, error: { code: -32020, message: 'Mcp-Method header does not match body' } });
  }
  const client = msg.params._meta['io.modelcontextprotocol/clientInfo'].name;

  // Step 2: run the tool. Any state it needs comes from the database, found by its ID.
  const result = tools[msg.params.name](msg.params.arguments);
  log(`${msg.params.name} from ${client}: ${JSON.stringify(result)}`);
  send(res, 200, {
    jsonrpc: '2.0', id: msg.id,
    result: { resultType: 'complete', content: [{ type: 'text', text: `[instance ${name}] ${JSON.stringify(result)}` }] },
  });
}).listen(port, () => log(`listening on :${port}`));

// Helpers
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
}
function send(res: ServerResponse, status: number, body: object) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function log(line: string) { console.log(`[instance ${name}] ${line}`); }
