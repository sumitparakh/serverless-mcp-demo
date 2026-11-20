// Priya's order-support MCP server: a stateless MCP server on Cloudflare Workers.
//
// The idea from the talk, in code:
//   * No session. createMcpHandler builds a fresh McpServer for EVERY request.
//   * State lives in D1 (the "Returns DB"), behind IDs like r_42 that the model keeps.
//   * Any instance can answer any request, so Cloudflare can run as many as it likes.

import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export interface Env {
  DB: D1Database;
}

// Demo shortcut: there is no login, so every call acts as Priya.
// In production, take the customer from the OAuth token, never from a tool argument.
const CUSTOMER_ID = "priya";

// A random ID per Worker isolate (one running copy of this code). It is only here so
// the demo can show that different requests are served by different copies.
// (Workers forbid random values at module load, so it is created on first use.)
let instanceId: string | undefined;
const instance = () => (instanceId ??= crypto.randomUUID().slice(0, 8));

const text = (data: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ ...data, served_by: instance() }, null, 2) }],
});

const fail = (message: string) => ({
  isError: true,
  content: [{ type: "text" as const, text: message }],
});

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;

function createServer(env: Env): McpServer {
  const server = new McpServer({ name: "order-support", version: "1.0.0" });

  server.registerTool(
    "get_order",
    {
      description: "Look up one of the customer's orders: status, delivery date and items.",
      inputSchema: z.object({ order_id: z.string().describe("Order number, for example 1042") }),
    },
    async ({ order_id }) => {
      const order = await env.DB.prepare(
        "SELECT id, status, delivery_date, total_cents FROM orders WHERE id = ? AND customer_id = ?",
      ).bind(order_id, CUSTOMER_ID).first();
      if (!order) return fail(`No order ${order_id} for this customer.`);
      const items = await env.DB.prepare("SELECT sku, name, price_cents FROM order_items WHERE order_id = ?")
        .bind(order_id).all();
      return text({ order, items: items.results });
    },
  );

  server.registerTool(
    "start_return",
    {
      description:
        "Start a return for an order. Returns a return_id (like r_42). Keep it and pass it to " +
        "add_item and get_return. Return IDs stay valid for 30 days.",
      inputSchema: z.object({ order_id: z.string() }),
    },
    async ({ order_id }) => {
      const order = await env.DB.prepare("SELECT id FROM orders WHERE id = ? AND customer_id = ?")
        .bind(order_id, CUSTOMER_ID).first();
      if (!order) return fail(`No order ${order_id} for this customer.`);
      const return_id = newId("r");
      await env.DB.prepare(
        "INSERT INTO returns (id, order_id, customer_id, status, created_at) VALUES (?, ?, ?, 'open', ?)",
      ).bind(return_id, order_id, CUSTOMER_ID, Date.now()).run();
      return text({ return_id, order_id, status: "open" });
    },
  );

  server.registerTool(
    "add_item",
    {
      description: "Add an item from the order to an open return.",
      inputSchema: z.object({
        return_id: z.string().describe("The ID from start_return"),
        sku: z.string().describe("Item SKU from get_order, for example TSHIRT-M"),
      }),
    },
    async ({ return_id, sku }) => {
      // Check ownership on EVERY call: a stateless server cannot assume this caller
      // is the one who started the return.
      const ret = await env.DB.prepare(
        "SELECT order_id, status FROM returns WHERE id = ? AND customer_id = ?",
      ).bind(return_id, CUSTOMER_ID).first<{ order_id: string; status: string }>();
      if (!ret) return fail(`Return ${return_id} not found. Start a new one with start_return.`);
      if (ret.status !== "open") return fail(`Return ${return_id} is ${ret.status} and cannot be changed.`);
      const item = await env.DB.prepare("SELECT sku FROM order_items WHERE order_id = ? AND sku = ?")
        .bind(ret.order_id, sku).first();
      if (!item) return fail(`${sku} is not in order ${ret.order_id}. Call get_order to see its items.`);
      await env.DB.prepare("INSERT OR IGNORE INTO return_items (return_id, sku) VALUES (?, ?)")
        .bind(return_id, sku).run();
      return text({ return_id, added: sku });
    },
  );

  server.registerTool(
    "get_return",
    {
      description: "Show a return and the items in it.",
      inputSchema: z.object({ return_id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ return_id }) => {
      const ret = await env.DB.prepare(
        "SELECT id, order_id, status, refund_id FROM returns WHERE id = ? AND customer_id = ?",
      ).bind(return_id, CUSTOMER_ID).first();
      if (!ret) return fail(`Return ${return_id} not found.`);
      const items = await env.DB.prepare("SELECT sku FROM return_items WHERE return_id = ?").bind(return_id).all();
      return text({ return: ret, items: items.results.map((r) => r.sku) });
    },
  );

  server.registerTool(
    "issue_refund",
    {
      description:
        "Refund the items in a return. Pass a new idempotency_key for each refund; if this " +
        "call is retried with the same key, the customer is not refunded twice.",
      inputSchema: z.object({
        return_id: z.string(),
        idempotency_key: z.string().min(8).describe("A unique string, for example a UUID"),
      }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ return_id, idempotency_key }) => {
      // Same key seen before? Return the original result instead of refunding again.
      const seen = await env.DB.prepare("SELECT id, return_id, amount_cents FROM refunds WHERE idempotency_key = ?")
        .bind(idempotency_key).first();
      if (seen) return text({ refund: seen, note: "Already processed. No second refund was made." });

      const ret = await env.DB.prepare("SELECT order_id, status FROM returns WHERE id = ? AND customer_id = ?")
        .bind(return_id, CUSTOMER_ID).first<{ order_id: string; status: string }>();
      if (!ret) return fail(`Return ${return_id} not found.`);
      if (ret.status !== "open") return fail(`Return ${return_id} is already ${ret.status}.`);
      const sum = await env.DB.prepare(
        `SELECT COALESCE(SUM(oi.price_cents), 0) AS amount FROM return_items ri
         JOIN order_items oi ON oi.order_id = ? AND oi.sku = ri.sku WHERE ri.return_id = ?`,
      ).bind(ret.order_id, return_id).first<{ amount: number }>();
      if (!sum || sum.amount === 0) return fail(`Return ${return_id} has no items. Use add_item first.`);

      const refund_id = newId("rf");
      // The UNIQUE constraint on idempotency_key makes two concurrent retries safe too.
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO refunds (id, return_id, idempotency_key, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)",
        ).bind(refund_id, return_id, idempotency_key, sum.amount, Date.now()),
        env.DB.prepare("UPDATE returns SET status = 'refunded', refund_id = ? WHERE id = ?").bind(refund_id, return_id),
      ]);
      return text({ refund: { id: refund_id, return_id, amount_cents: sum.amount } });
    },
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response("Order-support MCP server. Connect an MCP client to /mcp\n");
    }
    // A new McpServer for every request: nothing is kept in memory between calls.
    return createMcpHandler(() => createServer(env))(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
