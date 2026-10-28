require('dotenv').config();
const path = require('node:path');

const root = path.join(__dirname, '..');
const env = process.env;

function resolveFile(value) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(root, value);
}

module.exports = {
  root,
  port: Number(env.PORT) || 3000,
  publicUrl: (env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),

  ebook: {
    title: env.EBOOK_TITLE || 'Meu Ebook',
    subtitle: env.EBOOK_SUBTITLE || '',
    priceCents: Number(env.EBOOK_PRICE_CENTS) || 4790,
    file: resolveFile(env.EBOOK_FILE || 'private/ebook.pdf'),
  },

  prize: {
    title: env.PRIZE_TITLE || 'Bônus exclusivo',
    description: env.PRIZE_DESCRIPTION || 'Seu certificado foi validado.',
    file: resolveFile(env.PRIZE_FILE ?? 'private/premio.pdf'),
  },

  paymentProvider: (env.PAYMENT_PROVIDER || 'mock').toLowerCase(),

  blackcat: {
    apiUrl: (env.BLACKCAT_API_URL || '').replace(/\/$/, ''),
    // Chave secreta (sk_live_...). BLACKCAT_API_KEY continua funcionando como nome antigo.
    secretKey: env.BLACKCAT_SECRET_KEY || env.BLACKCAT_API_KEY || '',
    // Chave pública (pk_live_...). Só é usada se a forma de autenticação pedir.
    publicKey: env.BLACKCAT_PUBLIC_KEY || '',
    // Forma de autenticação. O "npm run testar-blackcat" descobre qual é a certa para a sua conta.
    authMode: (env.BLACKCAT_AUTH || 'x-api-key').toLowerCase(),
    createPath: env.BLACKCAT_CREATE_PATH || '/api/sales/create-sale',
    statusPath: env.BLACKCAT_STATUS_PATH || '/api/sales/{id}/status',
  },

  webhookSecret: env.WEBHOOK_SECRET || '',
  adminPassword: env.ADMIN_PASSWORD || '',
  dbFile: path.join(root, 'data', 'loja.db'),
};
