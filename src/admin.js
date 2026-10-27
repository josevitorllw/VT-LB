// Painel do dono do site: /admin (usuário "admin" + senha ADMIN_PASSWORD do .env).
// Mostra os cadastros (com os 5 dados) e as vendas, e exporta tudo em planilha (CSV).

const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const db = require('./db');
const { campos } = require('./fields');

const router = express.Router();

// ---------- Acesso ----------

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Bloqueia por 15 minutos o IP que errar a senha muitas vezes.
const failures = new Map();
const MAX_FAILURES = 10;
const BLOCK_MS = 15 * 60 * 1000;

router.use((req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  if (!config.adminPassword) {
    return res.status(503).send('Painel desativado: defina ADMIN_PASSWORD no arquivo .env e reinicie o site.');
  }
  const now = Date.now();
  const entry = failures.get(req.ip);
  if (entry && now - entry.start > BLOCK_MS) failures.delete(req.ip);
  if (entry && entry.count >= MAX_FAILURES && now - entry.start <= BLOCK_MS) {
    return res.status(429).send('Muitas tentativas erradas. Aguarde 15 minutos.');
  }

  const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString();
    const sep = decoded.indexOf(':');
    if (safeEqual(decoded.slice(0, sep), 'admin') && safeEqual(decoded.slice(sep + 1), config.adminPassword)) {
      failures.delete(req.ip);
      return next();
    }
    const current = failures.get(req.ip) || { start: now, count: 0 };
    current.count += 1;
    failures.set(req.ip, current);
  }
  res.set('WWW-Authenticate', 'Basic realm="Painel VT LB", charset="UTF-8"');
  res.status(401).send('Acesso restrito.');
});

// ---------- Formatação ----------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cpf = (v) => (/^\d{11}$/.test(v || '') ? v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : v || '');
const phone = (v) => {
  if (!/^\d{10,11}$/.test(v || '')) return v || '';
  return v.length === 11 ? v.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3') : v.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
};
const dateTime = (v) => (v
  ? new Date(`${v.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
  : '');
const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function formatAnswer(campo, value) {
  if (!value) return '';
  if (campo.tipo === 'telefone') return phone(value);
  if (campo.tipo === 'data') return value.split('-').reverse().join('/');
  return value;
}

const STATUS = { paid: 'Pago', pending: 'Aguardando', failed: 'Não pago' };

// ---------- Dados ----------

function registrations() {
  return db.prepare(`
    SELECT c.*, o.document, o.email AS order_email, o.phone AS order_phone
      FROM certificates c JOIN orders o ON o.id = c.order_id
     WHERE c.form_token IS NOT NULL
     ORDER BY COALESCE(c.details_at, c.issued_at) DESC
  `).all().map((r) => {
    const answers = r.details_json ? JSON.parse(r.details_json) : {};
    return {
      'Data do cadastro': dateTime(r.details_at),
      Situação: r.details_at ? 'Completo' : 'Faltam os dados',
      Nome: r.registered_name || r.name,
      CPF: cpf(r.document),
      'E-mail da compra': r.order_email,
      'Celular da compra': phone(r.order_phone),
      Certificado: r.code,
      ...Object.fromEntries(campos.map((c) => [c.label, formatAnswer(c, answers[c.id])])),
    };
  });
}

function sales() {
  return db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all().map((o) => ({
    Data: dateTime(o.created_at),
    Situação: STATUS[o.status] || o.status,
    Nome: o.name,
    CPF: cpf(o.document),
    'E-mail': o.email,
    Celular: phone(o.phone),
    Valor: brl(o.amount_cents),
    'Pago em': dateTime(o.paid_at),
  }));
}

// ---------- Planilhas (CSV para Excel / Google Planilhas) ----------

function toCsv(rows) {
  if (!rows.length) return '﻿Sem registros\r\n';
  const headers = Object.keys(rows[0]);
  const cell = (v) => {
    let s = String(v ?? '');
    // Evita fórmulas maliciosas ao abrir no Excel (um @perfil simples não é fórmula).
    if (/^[=+\-@\t\r]/.test(s) && !/^@[\w.]+$/.test(s)) s = `'${s}`;
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...rows.map((r) => headers.map((h) => r[h]))].map((line) => line.map(cell).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}

function sendCsv(res, name, rows) {
  const day = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${name}-${day}.csv"`,
  });
  res.send(toCsv(rows));
}

router.get('/cadastros.csv', (req, res) => sendCsv(res, 'cadastros', registrations()));
router.get('/vendas.csv', (req, res) => sendCsv(res, 'vendas', sales()));

// ---------- Página ----------

function table(rows, empty) {
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  const headers = Object.keys(rows[0]);
  return `<div class="table-wrap"><table>
    <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${headers.map((h) => `<td>${esc(r[h])}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

router.get('/', (req, res) => {
  const regs = registrations();
  const sold = sales();
  const paid = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS total FROM orders WHERE status = 'paid'").get();
  const complete = regs.filter((r) => r.Situação === 'Completo').length;

  res.send(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Painel</title>
  <link rel="stylesheet" href="/styles.css">
  <style>
    .container { max-width: 1200px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 8px; }
    .stat { background: #fff; border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; }
    .stat strong { display: block; font-size: 1.6rem; color: var(--accent); }
    .table-wrap { overflow-x: auto; background: #fff; border: 1px solid var(--line); border-radius: var(--radius); }
    table { border-collapse: collapse; width: 100%; font-size: .9rem; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
    th { background: var(--black); color: #fff; font-weight: 600; position: sticky; top: 0; }
    tr:last-child td { border-bottom: 0; }
    .bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
    .bar .btn { padding: 10px 14px; font-size: .9rem; }
  </style>
</head>
<body>
  <header class="site">
    <div class="container">
      <a class="brand" href="/admin">📕 VT LB · Painel</a>
      <nav><a href="/">Ver site</a></nav>
    </div>
  </header>
  <main>
    <div class="container">
      <div class="stats">
        <div class="stat"><strong>${paid.n}</strong>vendas pagas</div>
        <div class="stat"><strong>${esc(brl(paid.total))}</strong>arrecadado</div>
        <div class="stat"><strong>${complete}</strong>cadastros completos</div>
      </div>

      <div class="bar"><div class="section-title" style="flex:1">📝 Cadastros</div>
        <a class="btn" href="/admin/cadastros.csv">⬇ Baixar planilha</a></div>
      ${table(regs, 'Nenhum cadastro ainda.')}

      <div class="bar"><div class="section-title" style="flex:1">💰 Vendas</div>
        <a class="btn" href="/admin/vendas.csv">⬇ Baixar planilha</a></div>
      ${table(sold, 'Nenhuma venda ainda.')}
    </div>
  </main>
</body>
</html>`);
});

module.exports = router;
