const config = require('../config');

const providers = {
  mock: () => require('./mock'),
  blackcat: () => require('./blackcat'),
};

if (!providers[config.paymentProvider]) {
  throw new Error(`PAYMENT_PROVIDER inválido: "${config.paymentProvider}". Use "mock" ou "blackcat".`);
}

module.exports = providers[config.paymentProvider]();
