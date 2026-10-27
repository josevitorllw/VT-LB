// Integração com a BlackCat.
//
// IMPORTANTE: os nomes dos campos abaixo seguem o padrão mais comum da API da
// BlackCat (chave no cabeçalho X-API-Key, valores em centavos, status PENDING/PAID).
// Antes de vender de verdade, confira na documentação do seu painel da BlackCat e
// ajuste SÓ este arquivo se algo for diferente. O resto do site não muda.

const config = require('../config');

const { apiUrl, apiKey, createPath, statusPath } = config.blackcat;

async function request(method, urlPath, body) {
  if (!apiUrl || !apiKey) {
    throw new Error('BlackCat não configurada: preencha BLACKCAT_API_URL e BLACKCAT_API_KEY no .env');
  }
  const res = await fetch(apiUrl + urlPath, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-Key': apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    console.error('[blackcat] erro', res.status, text);
    throw new Error(`BlackCat respondeu ${res.status}`);
  }
  // Algumas respostas vêm embrulhadas em { data: {...} }
  return json && typeof json.data === 'object' && json.data !== null ? json.data : json;
}

// Procura o primeiro campo preenchido entre vários nomes possíveis.
function pick(obj, paths) {
  for (const p of paths) {
    const value = p.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
    if (value != null && value !== '') return value;
  }
  return null;
}

function normalizeStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (['paid', 'approved', 'completed', 'confirmed', 'pago', 'aprovado'].includes(s)) return 'paid';
  if (['cancelled', 'canceled', 'refused', 'failed', 'expired', 'refunded', 'chargeback'].includes(s)) return 'failed';
  return 'pending';
}

async function createPix(order) {
  const digits = (v) => String(v || '').replace(/\D/g, '');
  const result = await request('POST', createPath, {
    amount: order.amount_cents,
    currency: 'BRL',
    paymentMethod: 'pix',
    externalRef: order.id,
    postbackUrl: `${config.publicUrl}/api/webhooks/blackcat?secret=${encodeURIComponent(config.webhookSecret)}`,
    items: [
      {
        title: config.ebook.title,
        unitPrice: order.amount_cents,
        quantity: 1,
        tangible: false,
      },
    ],
    customer: {
      name: order.name,
      email: order.email,
      phone: digits(order.phone),
      document: { number: digits(order.document), type: 'cpf' },
    },
  });

  const gatewayId = pick(result, ['id', 'transactionId', 'saleId', 'transaction.id']);
  const pixCode = pick(result, [
    'pix.qrcode', 'pix.qrCode', 'pix.copyPaste', 'pix.code', 'pix.emv',
    'pixCode', 'qrCode', 'qrcode', 'copyPaste', 'paymentData.qrCode',
  ]);
  const qrImage = pick(result, ['pix.qrCodeImage', 'pix.qrcodeImage', 'pix.qrCodeBase64', 'qrCodeImage', 'qrCodeBase64']);

  if (!gatewayId || !pixCode) {
    console.error('[blackcat] resposta inesperada ao criar Pix:', JSON.stringify(result));
    throw new Error('Resposta da BlackCat sem id ou código Pix');
  }
  return { gatewayId: String(gatewayId), pixCode, qrImage };
}

async function getStatus(gatewayId) {
  const result = await request('GET', statusPath.replace('{id}', encodeURIComponent(gatewayId)));
  return normalizeStatus(pick(result, ['status', 'transaction.status', 'paymentStatus']));
}

// Extrai o id da transação do corpo do webhook. O status NÃO é confiado:
// sempre consultamos a BlackCat de novo antes de liberar o ebook.
function webhookTransactionId(body) {
  const id = pick(body || {}, ['id', 'transactionId', 'saleId', 'data.id', 'data.transactionId', 'transaction.id']);
  return id == null ? null : String(id);
}

module.exports = { createPix, getStatus, webhookTransactionId };
