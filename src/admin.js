// Painel do dono do site: /admin (usuário "admin" + senha ADMIN_PASSWORD do .env).
// Mostra os cadastros (com os 5 dados) e as vendas, e exporta tudo em planilha (CSV).

const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const db = require('./db');
const { campos } = require('./fields');
const files = require('./files');
const { runBlackcatTest } = require('./payments/blackcatTest');

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

// ---------- Arquivos (ebook, prêmio, foto) ----------

// O navegador manda o arquivo puro no corpo; o nome original vem no cabeçalho X-Filename.
router.post('/arquivos/:kind', express.raw({ type: () => true, limit: '200mb' }), (req, res) => {
  try {
    const name = decodeURIComponent(String(req.headers['x-filename'] || ''));
    files.saveUpload(req.params.kind, name, req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function fileRow(kind) {
  const spec = files.KINDS[kind];
  const current = files.describe({ ebook: files.ebookFile, premio: files.prizeFile, capa: files.coverFile }[kind]());
  const info = current
    ? `✅ ${esc(current.name)} · ${(current.size / 1024 / 1024).toFixed(2)} MB`
    : '⚠️ Nenhum arquivo enviado';
  return `<div class="file-row">
    <div><strong>${esc(spec.label)}</strong><br><span class="muted">${info}</span></div>
    <label class="btn secondary">Enviar arquivo
      <input type="file" hidden data-kind="${kind}" accept="${spec.extensions.join(',')}">
    </label>
  </div>`;
}

// ---------- Teste da BlackCat ----------

router.post('/testar-blackcat', express.json(), async (req, res) => {
  const { name, document, email, phone } = req.body || {};
  if (!name || !document || !email || !phone) return res.status(400).json({ lines: ['Preencha todos os campos.'] });
  res.json(await runBlackcatTest({ name, document, email, phone }));
});

function paymentStatus() {
  if (config.paymentProvider !== 'mock') return ['ok', `Pagamentos: ${esc(config.paymentProvider)} (cobrança real).`];
  if (config.isProduction && !config.allowSimulate) {
    return ['warn', 'Vendas FECHADAS: configure a BlackCat (PAYMENT_PROVIDER=blackcat) para começar a vender.'];
  }
  return ['warn', 'Modo de TESTE: o pagamento é simulado, nenhuma cobrança real.'];
}

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
    .file-row { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap;
      padding: 12px 0; border-bottom: 1px solid var(--line); }
    .file-row:last-child { border-bottom: 0; }
    .file-row .btn { padding: 10px 14px; font-size: .9rem; cursor: pointer; }
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
      <div class="alert ${paymentStatus()[0]}" style="margin-bottom:16px">${paymentStatus()[1]}</div>

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

      <div class="section-title">📁 Arquivos do site</div>
      <div class="card" style="padding:8px 20px">
        ${['ebook', 'premio', 'capa'].map(fileRow).join('')}
      </div>
      <p class="muted">O ebook recebe o certificado de cada comprador na primeira página. Enviar de novo substitui o anterior.</p>

      <div class="section-title">🔌 Testar conexão com a BlackCat</div>
      <form class="card" id="bc-test" style="margin-top:0">
        <p class="muted" style="margin:0">Cria um Pix de teste (no valor do ebook) com os seus dados. Se ninguém pagar, ele expira sozinho.</p>
        <label>Seu nome <input name="name" required></label>
        <label>Seu CPF <input name="document" inputmode="numeric" required></label>
        <label>Seu e-mail <input name="email" type="email" required></label>
        <label>Seu celular com DDD <input name="phone" inputmode="numeric" required></label>
        <button class="btn" type="submit">Testar conexão</button>
        <pre id="bc-result" class="pix-code hidden" style="white-space:pre-wrap;font-size:.85rem"></pre>
      </form>
    </div>
  </main>
  <script>
    document.querySelectorAll('input[type=file][data-kind]').forEach((input) => {
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const label = input.parentElement;
        label.firstChild.textContent = 'Enviando… ';
        const res = await fetch('/admin/arquivos/' + input.dataset.kind, {
          method: 'POST',
          headers: { 'X-Filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' },
          body: file,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) alert(data.error || 'Não foi possível enviar.');
        location.reload();
      });
    });

    document.getElementById('bc-test').addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = document.getElementById('bc-result');
      const button = e.target.querySelector('button');
      button.disabled = true;
      out.textContent = 'Testando…';
      out.classList.remove('hidden');
      const res = await fetch('/admin/testar-blackcat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
      });
      const data = await res.json().catch(() => ({ lines: ['Erro ao testar.'] }));
      out.textContent = data.lines.join('\n');
      button.disabled = false;
    });
  </script>
</body>
</html>`);
});

module.exports = router;
