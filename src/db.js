const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
const db = new DatabaseSync(config.dbFile);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS orders (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    email          TEXT NOT NULL,
    phone          TEXT,
    document       TEXT,
    amount_cents   INTEGER NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending',
    gateway_id     TEXT,
    pix_code       TEXT,
    pix_qr_image   TEXT,
    download_token TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at        TEXT
  );
  CREATE INDEX IF NOT EXISTS orders_gateway_id ON orders (gateway_id);

  CREATE TABLE IF NOT EXISTS certificates (
    code        TEXT PRIMARY KEY,
    order_id    TEXT NOT NULL UNIQUE REFERENCES orders (id),
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    issued_at   TEXT NOT NULL DEFAULT (datetime('now')),
    redeemed_at TEXT,
    registered_name TEXT,
    prize_token TEXT
  );
`);

module.exports = db;
