// Modo de teste: gera um Pix falso e permite "simular pagamento" na página do pedido.
const crypto = require('node:crypto');

const paid = new Set();

async function createPix(order) {
  const gatewayId = `mock_${crypto.randomUUID()}`;
  return {
    gatewayId,
    pixCode: `00020126580014BR.GOV.BCB.PIX-TESTE-${order.id}`,
    qrImage: null,
  };
}

async function getStatus(gatewayId) {
  return paid.has(gatewayId) ? 'paid' : 'pending';
}

function markPaid(gatewayId) {
  paid.add(gatewayId);
}

function webhookTransactionId() {
  return null;
}

module.exports = { createPix, getStatus, markPaid, webhookTransactionId };
