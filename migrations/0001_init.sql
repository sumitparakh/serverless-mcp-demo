-- Schema and demo data for Priya's order-support server.

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  delivery_date TEXT,
  total_cents INTEGER NOT NULL
);

CREATE TABLE order_items (
  order_id TEXT NOT NULL REFERENCES orders(id),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  PRIMARY KEY (order_id, sku)
);

CREATE TABLE returns (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL,          -- open | refunded
  refund_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE return_items (
  return_id TEXT NOT NULL REFERENCES returns(id),
  sku TEXT NOT NULL,
  PRIMARY KEY (return_id, sku)
);

CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES returns(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO orders VALUES ('1042', 'priya', 'delivered', '2026-11-14', 8499);
INSERT INTO order_items VALUES
  ('1042', 'TSHIRT-M', 'Organic cotton T-shirt, medium', 2999),
  ('1042', 'SOCKS-L',  'Wool socks, large',              1500),
  ('1042', 'CAP-1',    'Canvas cap',                     4000);

INSERT INTO orders VALUES ('1057', 'priya', 'shipped', '2026-11-22', 6000);
INSERT INTO order_items VALUES ('1057', 'HOODIE-S', 'Fleece hoodie, small', 6000);

-- Someone else's order: Priya's tools must never see it.
INSERT INTO orders VALUES ('2001', 'alex', 'delivered', '2026-11-10', 2999);
INSERT INTO order_items VALUES ('2001', 'TSHIRT-M', 'Organic cotton T-shirt, medium', 2999);
