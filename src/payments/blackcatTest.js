// Teste da conexão com a BlackCat, usado pelo "npm run testar-blackcat" e pelo botão do painel /admin.
// Cria UMA cobrança Pix de verdade (no valor do ebook); ela expira sozinha se ninguém pagar.
// Se BLACKCAT_AUTH não estiver definido, experimenta as formas de autenticação até uma ser aceita.

const crypto = require('node:crypto');
const config = require('../config');
const blackcat = require('./blackcat');

const mask = (v) => (v ? `preenchida (${v.slice(0, 8)}…, ${v.length} caracteres)` : '(vazia)');

async function runBlackcatTest({ name, document, email, phone }) {
  const lines = [];
  const log = (...parts) => lines.push(parts.join(' '));
  const bc = config.blackcat;
  const done = (ok) => ({ ok, lines });

  log('=== Teste da BlackCat ===');
  log('Endereço da API:', bc.apiUrl || '(vazio!)');
  log('Chave secreta:  ', mask(bc.secretKey));
  log('Chave pública:  ', mask(bc.publicKey));
  log('Link de aviso:  ', `${config.publicUrl}/api/webhooks/blackcat?secret=***`);
  if (!bc.apiUrl || !bc.secretKey) {
    log('');
    log('❌ Preencha BLACKCAT_API_URL e BLACKCAT_SECRET_KEY (no .env ou nas variáveis da Railway).');
    return done(false);
  }
  if (config.publicUrl.includes('localhost')) {
    log('⚠️  O endereço do site ainda é localhost: a BlackCat não vai conseguir avisar quando o Pix for pago.');
  }
  if (!config.webhookSecret || config.webhookSecret === 'troque-este-segredo') {
    log('⚠️  Defina WEBHOOK_SECRET com um texto longo e aleatório.');
  }

  const fixed = process.env.BLACKCAT_AUTH;
  const modes = fixed ? [fixed.toLowerCase()] : Object.keys(blackcat.AUTH_MODES)
    .filter((m) => bc.publicKey || !m.includes('public'));

  log('');

  log(`1) Criando um Pix de ${(config.ebook.priceCents / 100).toFixed(2)} reais...`);
  let pix;
  let workingMode;
  try {
    for (const mode of modes) {
      blackcat.setAuthMode(mode);
      try {
        pix = await blackcat.createPix({
          id: crypto.randomUUID(), name, email, phone, document, amount_cents: config.ebook.priceCents,
        });
        workingMode = mode;
        break;
      } catch (err) {
        if ((err.status === 401 || err.status === 403) && !fixed) {
          log(`   • autenticação "${mode}": recusada`);
          continue;
        }
        log(`❌ Falhou (autenticação "${mode}"):`, err.message);
        if (err.body) log('   Resposta da BlackCat:', err.body);
        if (err.shape) log('   Estrutura da resposta (mande isto para ajustar):', err.shape);
        if (err.status === 401 || err.status === 403) log('   → A chave parece errada ou sem permissão.');
        if (err.status === 404) log('   → O endereço ou o caminho da API está errado (BLACKCAT_API_URL / BLACKCAT_CREATE_PATH).');
        if (err.status === 400 || err.status === 422) {
          log('   → A autenticação passou, mas a BlackCat recusou os dados enviados. Mande a resposta acima para ajustar.');
        }
        if (!err.status) log('   → Não deu para falar com a BlackCat. Confira o BLACKCAT_API_URL.');
        return done(false);
      }
    }
    if (!pix) {
      log('❌ Nenhuma forma de autenticação foi aceita. Confira se as chaves estão certas e se são de produção.');
      return done(false);
    }
    log(`✅ Pix criado! (autenticação "${workingMode}")`);
    log('   Id da transação:', pix.gatewayId);
    log('   Copia e cola:   ', `${pix.pixCode.slice(0, 30)}...`);

    log('');

    log('2) Consultando o status...');
    try {
      const status = await blackcat.getStatus(pix.gatewayId);
      log(`✅ Status: ${status === 'pending' ? 'aguardando pagamento' : status}`);
    } catch (err) {
      log('❌ Falhou:', err.message);
      if (err.body) log('   Resposta da BlackCat:', err.body);
      if (err.status === 404) log('   → Confira o caminho BLACKCAT_STATUS_PATH.');
      return done(false);
    }
  } finally {
    blackcat.setAuthMode(config.blackcat.authMode); // volta à forma configurada
  }

  log('');

  log('🎉 Tudo certo! Coloque estas variáveis (no .env ou na Railway) e reinicie o site:');
  log(`   BLACKCAT_AUTH=${workingMode}`);
  log('   PAYMENT_PROVIDER=blackcat');
  return done(true);
}

module.exports = { runBlackcatTest };
