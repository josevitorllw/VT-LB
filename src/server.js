const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const QRCode = require('qrcode');

const config = require('./config');
const db = require('./db');
const payments = require('./payments');
const { certificateCode, token } = require('./codes');
const { buildEbookWithCertificate, readCertificateCode } = require('./certificatePdf');
const { publicFields, validateAnswers } = require('./fields');
const adminRouter = require('./admin');

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

// Limite simples de tentativas por IP.
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
  if (!isValidCpf(document)) return res.status(400).json({ error: 'CPF inválido.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  if (phone.length < 10 || phone.length > 11) return res.status(400).json({ error: 'Informe um celular com DDD.' });

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
    body.downloadUrl = `/download/${order.download_token}`;
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

// Cadastro: a pessoa anexa o PDF do certificado e informa nome e CPF.
// O arquivo vai no corpo da requisição; nome e CPF vão na URL.
app.post(
  '/api/register',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 15 }),
  express.raw({ type: () => true, limit: '60mb' }),
  async (req, res) => {
    const name = String(req.query.name || '').trim();
    const cpf = String(req.query.cpf || '').replace(/\D/g, '');
    const file = Buffer.isBuffer(req.body) ? req.body : null;

    if (!file || !file.length) return res.status(400).json({ error: 'Anexe o arquivo do certificado.' });
    if (name.length < 3) return res.status(400).json({ error: 'Informe seu nome completo.' });
    if (!isValidCpf(cpf)) return res.status(400).json({ error: 'CPF inválido.' });
    if (file.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return res.status(400).json({ error: 'O certificado precisa ser o arquivo PDF que você baixou depois da compra.' });
    }

    const code = await readCertificateCode(file);
    const cert = code && getCertificate.get(code);
    if (!cert) {
      return res.status(400).json({
        error: 'Não reconhecemos este certificado. Anexe o arquivo PDF que você baixou depois da compra, sem editar.',
      });
    }
    if (getOrder.get(cert.order_id).document !== cpf) {
      return res.status(400).json({ error: 'Este certificado não pertence ao CPF informado.' });
    }

    // Quem já cadastrou tudo pode ver o prêmio de novo, mas não ganha outro.
    if (cert.redeemed_at) return res.json(prizeResponse(cert, true));

    // Certificado aceito: próximo passo é a tela dos 5 dados.
    const formToken = cert.form_token || token();
    db.prepare('UPDATE certificates SET form_token = ?, registered_name = ? WHERE code = ?').run(formToken, name, code);
    res.json({ step: 'details', formToken, name, fields: publicFields() });
  }
);

function prizeResponse(cert, alreadyRedeemed) {
  return {
    step: 'prize',
    alreadyRedeemed,
    name: cert.registered_name || cert.name,
    prizeTitle: config.prize.title,
    prizeDescription: config.prize.description,
    prizeUrl: config.prize.file && fs.existsSync(config.prize.file) ? `/premio/download/${cert.prize_token}` : null,
  };
}

// Tela dos 5 dados: salva as respostas e libera o prêmio.
app.post('/api/register/details', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }), (req, res) => {
  const formToken = String(req.body.formToken || '');
  const cert = formToken && db.prepare('SELECT * FROM certificates WHERE form_token = ?').get(formToken);
  if (!cert) return res.status(400).json({ error: 'Cadastro expirado. Anexe o certificado de novo.' });
  if (cert.redeemed_at) return res.json(prizeResponse(cert, true));

  const { values, error } = validateAnswers(req.body.answers);
  if (error) return res.status(400).json({ error });

  db.prepare(
    `UPDATE certificates
        SET details_json = ?, details_at = datetime('now'), redeemed_at = datetime('now'), prize_token = ?
      WHERE code = ? AND redeemed_at IS NULL`
  ).run(JSON.stringify(values), token(), cert.code);
  res.json(prizeResponse(getCertificate.get(cert.code), false));
});

// ---------- Downloads protegidos ----------

app.get('/download/:token', async (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE download_token = ? AND status = 'paid'").get(req.params.token);
  if (!order) return res.status(404).send('Link inválido.');
  try {
    const pdf = await buildEbookWithCertificate(getCertificateByOrder.get(order.id));
    const filename = `${config.ebook.title} - com certificado.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
    res.send(Buffer.from(pdf));
  } catch (err) {
    console.error('[download] erro ao gerar PDF:', err);
    res.status(500).send('Não foi possível gerar o arquivo agora. Tente novamente.');
  }
});

app.get('/premio/download/:token', (req, res) => {
  const cert = db.prepare('SELECT * FROM certificates WHERE prize_token = ?').get(req.params.token);
  if (!cert) return res.status(404).send('Link inválido.');
  const file = config.prize.file;
  if (!file || !fs.existsSync(file)) return res.status(404).send('Arquivo ainda não disponível. Fale com o suporte.');
  res.download(file, `${config.prize.title}${path.extname(file)}`);
});

// ---------- Páginas ----------

app.get('/', page('index.html'));
app.get('/cadastro', page('cadastro.html'));
app.get('/comprar', page('comprar.html'));
app.get('/pedido/:id', page('pedido.html'));
app.get('/premio', (req, res) => res.redirect('/cadastro'));
app.use('/admin', adminRouter);
app.use(express.static(publicDir, { index: false }));

app.listen(config.port, () => {
  console.log(`Site rodando em http://localhost:${config.port}`);
  console.log(`Pagamento: ${config.paymentProvider === 'mock' ? 'MODO DE TESTE' : 'BlackCat'}`);
});
