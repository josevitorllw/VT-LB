const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const QRCode = require('qrcode');

const config = require('./config');
const db = require('./db');
const payments = require('./payments');
const { certificateCode, normalizeCertificateCode, token } = require('./codes');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '100kb' }));

const publicDir = path.join(config.root, 'public');
const page = (file) => (req, res) => res.sendFile(path.join(publicDir, file));

// ---------- Utilitários ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidCpf(value) {
  const cpf = String(value || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const digit = ((sum * 10) % 11) % 10;
    if (digit !== Number(cpf[len])) return false;
  }
  return true;
}

// Limite simples de tentativas por IP (protege o resgate contra chute de códigos).
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const entry = hits.get(req.ip);
    if (!entry || now - entry.start > windowMs) {
      hits.set(req.ip, { start: now, count: 1 });
      return next();
    }
    if (++entry.count > max) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
    }
    next();
  };
}

const getOrder = db.prepare('SELECT * FROM orders WHERE id = ?');
const getOrderByGateway = db.prepare('SELECT * FROM orders WHERE gateway_id = ?');
const getCertificateByOrder = db.prepare('SELECT * FROM certificates WHERE order_id = ?');
const getCertificate = db.prepare('SELECT * FROM certificates WHERE code = ?');

// Marca o pedido como pago e emite o certificado (uma única vez).
function markOrderPaid(orderId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const order = getOrder.get(orderId);
    if (order && order.status !== 'paid') {
      db.prepare(
        "UPDATE orders SET status = 'paid', paid_at = datetime('now'), download_token = ? WHERE id = ?"
      ).run(token(), orderId);
      const insert = db.prepare('INSERT OR IGNORE INTO certificates (code, order_id, name, email) VALUES (?, ?, ?, ?)');
      while (!getCertificateByOrder.get(orderId)) {
        insert.run(certificateCode(), orderId, order.name, order.email);
      }
      console.log(`[pedido] ${orderId} pago`);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Consulta o gateway no máximo a cada 5s por pedido (a página do pedido fica consultando).
const lastCheck = new Map();
async function refreshOrderStatus(order) {
  if (order.status !== 'pending' || !order.gateway_id) return order;
  const now = Date.now();
  if (now - (lastCheck.get(order.id) || 0) < 5000) return order;
  lastCheck.set(order.id, now);
  try {
    const status = await payments.getStatus(order.gateway_id);
    if (status === 'paid') markOrderPaid(order.id);
    else if (status === 'failed') db.prepare("UPDATE orders SET status = 'failed' WHERE id = ?").run(order.id);
  } catch (err) {
    console.error('[pedido] erro ao consultar status:', err.message);
  }
  return getOrder.get(order.id);
}

// ---------- API ----------

app.get('/api/config', (req, res) => {
  res.json({
    ebookTitle: config.ebook.title,
    ebookSubtitle: config.ebook.subtitle,
    priceCents: config.ebook.priceCents,
    prizeTitle: config.prize.title,
    testMode: config.paymentProvider === 'mock',
  });
});

app.post('/api/orders', rateLimit({ windowMs: 10 * 60 * 1000, max: 10 }), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').replace(/\D/g, '');
  const document = String(req.body.document || '').replace(/\D/g, '');

  if (name.length < 3) return res.status(400).json({ error: 'Informe seu nome completo.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  if (phone.length < 10 || phone.length > 11) return res.status(400).json({ error: 'Informe um telefone com DDD.' });
  if (!isValidCpf(document)) return res.status(400).json({ error: 'CPF inválido.' });

  const order = {
    id: crypto.randomUUID(),
    name,
    email,
    phone,
    document,
    amount_cents: config.ebook.priceCents,
  };
  db.prepare(
    'INSERT INTO orders (id, name, email, phone, document, amount_cents) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(order.id, name, email, phone, document, order.amount_cents);

  try {
    const pix = await payments.createPix(order);
    const qrImage = pix.qrImage
      ? (String(pix.qrImage).startsWith('data:') ? pix.qrImage : `data:image/png;base64,${pix.qrImage}`)
      : await QRCode.toDataURL(pix.pixCode, { margin: 1, width: 320 });
    db.prepare('UPDATE orders SET gateway_id = ?, pix_code = ?, pix_qr_image = ? WHERE id = ?')
      .run(pix.gatewayId, pix.pixCode, qrImage, order.id);
    res.json({ id: order.id });
  } catch (err) {
    console.error('[pedido] erro ao gerar Pix:', err.message);
    db.prepare("UPDATE orders SET status = 'failed' WHERE id = ?").run(order.id);
    res.status(502).json({ error: 'Não foi possível gerar o Pix agora. Tente novamente em instantes.' });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  let order = getOrder.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  order = await refreshOrderStatus(order);

  const body = {
    id: order.id,
    status: order.status,
    name: order.name,
    amountCents: order.amount_cents,
    ebookTitle: config.ebook.title,
    testMode: config.paymentProvider === 'mock',
  };
  if (order.status === 'pending') {
    body.pixCode = order.pix_code;
    body.pixQrImage = order.pix_qr_image;
  }
  if (order.status === 'paid') {
    const cert = getCertificateByOrder.get(order.id);
    body.downloadUrl = `/download/${order.download_token}`;
    body.certificateCode = cert.code;
    body.certificateUrl = `/certificado/${cert.code}`;
  }
  res.json(body);
});

// Só existe no modo de teste.
app.post('/api/orders/:id/simulate-payment', (req, res) => {
  if (config.paymentProvider !== 'mock') return res.status(404).end();
  const order = getOrder.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  payments.markPaid(order.gateway_id);
  markOrderPaid(order.id);
  res.json({ ok: true });
});

// Notificação de pagamento da BlackCat.
app.post('/api/webhooks/blackcat', async (req, res) => {
  const secret = String(req.query.secret || '');
  const expected = config.webhookSecret;
  const ok = expected
    && secret.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected));
  if (!ok) return res.status(401).end();

  const gatewayId = payments.webhookTransactionId(req.body);
  const order = gatewayId && getOrderByGateway.get(gatewayId);
  if (!order) return res.status(200).json({ ignored: true });

  try {
    // Não confia no corpo do webhook: confirma o status direto na BlackCat.
    const status = await payments.getStatus(gatewayId);
    if (status === 'paid') markOrderPaid(order.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[webhook] erro:', err.message);
    res.status(500).end();
  }
});

app.get('/api/certificates/:code', (req, res) => {
  const code = normalizeCertificateCode(req.params.code);
  const cert = code && getCertificate.get(code);
  if (!cert) return res.status(404).json({ error: 'Certificado não encontrado.' });
  res.json({
    code: cert.code,
    name: cert.name,
    issuedAt: cert.issued_at,
    ebookTitle: config.ebook.title,
  });
});

app.post('/api/redeem', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), (req, res) => {
  const code = normalizeCertificateCode(req.body.code);
  const email = String(req.body.email || '').trim().toLowerCase();
  const cert = code && getCertificate.get(code);

  if (!cert || cert.email !== email) {
    return res.status(400).json({ error: 'Certificado não encontrado. Confira o código e o e-mail usado na compra.' });
  }

  let prizeToken = cert.prize_token;
  if (!cert.redeemed_at) {
    prizeToken = token();
    db.prepare("UPDATE certificates SET redeemed_at = datetime('now'), prize_token = ? WHERE code = ? AND redeemed_at IS NULL")
      .run(prizeToken, code);
    prizeToken = getCertificate.get(code).prize_token;
  }

  // Quem já resgatou pode voltar e ver o prêmio de novo, mas não ganha outro.
  res.json({
    alreadyRedeemed: Boolean(cert.redeemed_at),
    name: cert.name,
    prizeTitle: config.prize.title,
    prizeDescription: config.prize.description,
    prizeUrl: config.prize.file && fs.existsSync(config.prize.file) ? `/premio/download/${prizeToken}` : null,
  });
});

// ---------- Downloads protegidos ----------

function sendPrivateFile(res, file, downloadName) {
  if (!file || !fs.existsSync(file)) {
    return res.status(404).send('Arquivo ainda não disponível. Fale com o suporte.');
  }
  res.download(file, downloadName);
}

app.get('/download/:token', (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE download_token = ? AND status = 'paid'").get(req.params.token);
  if (!order) return res.status(404).send('Link inválido.');
  sendPrivateFile(res, config.ebook.file, `${config.ebook.title}${path.extname(config.ebook.file)}`);
});

app.get('/premio/download/:token', (req, res) => {
  const cert = db.prepare('SELECT * FROM certificates WHERE prize_token = ?').get(req.params.token);
  if (!cert) return res.status(404).send('Link inválido.');
  sendPrivateFile(res, config.prize.file, `${config.prize.title}${path.extname(config.prize.file)}`);
});

// ---------- Páginas ----------

app.get('/', page('index.html'));
app.get('/pedido/:id', page('pedido.html'));
app.get('/certificado/:code', page('certificado.html'));
app.get('/premio', page('premio.html'));
app.use(express.static(publicDir, { index: false }));

app.listen(config.port, () => {
  console.log(`Site rodando em http://localhost:${config.port}`);
  console.log(`Pagamento: ${config.paymentProvider === 'mock' ? 'MODO DE TESTE' : 'BlackCat'}`);
});
