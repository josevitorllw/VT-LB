const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { dataDir } = require('./files');

fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'loja.db'));

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

// Colunas adicionadas depois da primeira versão (bancos antigos ganham as colunas sozinhos).
const newColumns = {
  certificates: {
    registered_name: 'TEXT',
    form_token: 'TEXT',      // libera a tela dos 5 dados depois que o certificado é aceito
    details_json: 'TEXT',    // respostas dos 5 dados (JSON)
    details_at: 'TEXT',
  },
};
for (const [table, columns] of Object.entries(newColumns)) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

module.exports = db;
