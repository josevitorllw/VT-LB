require('dotenv').config();
const path = require('node:path');

const root = path.join(__dirname, '..');
const env = process.env;

module.exports = {
  root,
  port: Number(env.PORT) || 3000,
  // Endereço público do site. Na Railway, se PUBLIC_URL não for definido, usa o domínio que ela gera.
  publicUrl: (env.PUBLIC_URL
    || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3000')).replace(/\/$/, ''),
  // No ar (Railway ou NODE_ENV=production) o modo de teste não deixa simular pagamento.
  isProduction: env.NODE_ENV === 'production' || Boolean(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT),
  allowSimulate: env.ALLOW_SIMULATE === 'true',

  ebook: {
    title: env.EBOOK_TITLE || 'Meu Ebook',
    subtitle: env.EBOOK_SUBTITLE || '',
    priceCents: Number(env.EBOOK_PRICE_CENTS) || 4790,
  },

  prize: {
    title: env.PRIZE_TITLE || 'Bônus exclusivo',
    description: env.PRIZE_DESCRIPTION || 'Seu certificado foi validado.',
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
};
