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
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    console.error('[blackcat] erro', res.status, text.slice(0, 500));
    const err = new Error(`BlackCat respondeu ${res.status}`);
    err.status = res.status;
    err.body = text.slice(0, 500);
    throw err;
  }
  // Algumas respostas vêm embrulhadas em { data: {...} }
  return json && typeof json.data === 'object' && json.data !== null ? json.data : json;
}

// Procura, em qualquer nível da resposta, o primeiro campo com um destes nomes que passe no teste.
// (A BlackCat pode devolver os dados em "data", "pix", "paymentData"... assim funciona em todos os casos.)
function findField(obj, names, accept = (v) => v != null && v !== '') {
  const wanted = names.map((n) => n.toLowerCase());
  for (const name of wanted) {
    const queue = [obj];
    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== 'object') continue;
      for (const [key, value] of Object.entries(current)) {
        if (key.toLowerCase() === name && (typeof value === 'string' || typeof value === 'number') && accept(value)) {
          return value;
        }
        if (value && typeof value === 'object') queue.push(value);
      }
    }
  }
  return null;
}

// Mostra só a estrutura da resposta (nomes e tipos dos campos), sem dados pessoais, para diagnóstico.
function describeShape(value, depth = 0) {
  if (Array.isArray(value)) return value.length ? [describeShape(value[0], depth + 1)] : [];
  if (value && typeof value === 'object') {
    if (depth > 4) return '{...}';
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, describeShape(v, depth + 1)]));
  }
  return value === null ? 'null' : typeof value;
}

const isPixCode = (v) => /^000201/.test(String(v).trim());
const isImage = (v) => /^(data:image\/|https?:\/\/|iVBOR|\/9j\/)/.test(String(v).trim());

function normalizeStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (['paid', 'approved', 'completed', 'confirmed', 'pago', 'aprovado'].includes(s)) return 'paid';
  if (['cancelled', 'canceled', 'refused', 'failed', 'expired', 'refunded', 'chargeback', 'chargedback'].includes(s)) {
    return 'failed';
  }
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

  const gatewayId = findField(result, ['transactionId', 'id', 'saleId']);
  // O "copia e cola" sempre começa com 000201; assim não confundimos com a imagem do QR Code.
  const pixCode = findField(result, ['copyPaste', 'copiaECola', 'emv', 'brcode', 'qrcode', 'qrCode', 'pixCode', 'code'], isPixCode);
  const qrImage = findField(result, ['qrCodeBase64', 'qrcodeBase64', 'qrCodeImage', 'qrcodeImage', 'qrCodeUrl', 'qrCode', 'qrcode'], isImage);

  if (!gatewayId || !pixCode) {
    const shape = JSON.stringify(describeShape(result));
    console.error('[blackcat] resposta sem id ou código Pix. Estrutura recebida:', shape);
    const err = new Error('Resposta da BlackCat sem id ou código Pix');
    err.shape = shape;
    throw err;
  }
  return { gatewayId: String(gatewayId), pixCode: String(pixCode).trim(), qrImage };
}

async function getStatus(gatewayId) {
  const result = await request('GET', statusPath.replace('{id}', encodeURIComponent(gatewayId)));
  const status = findField(result, ['status', 'paymentStatus']);
  if (!status) console.error('[blackcat] status não encontrado. Estrutura recebida:', JSON.stringify(describeShape(result)));
  return normalizeStatus(status);
}

// Extrai o id da transação do corpo do webhook. O status NÃO é confiado:
// sempre consultamos a BlackCat de novo antes de liberar o ebook.
function webhookTransactionId(body) {
  const id = findField(body || {}, ['transactionId', 'id', 'saleId']);
  return id == null ? null : String(id);
}

module.exports = { createPix, getStatus, webhookTransactionId, describeShape };
