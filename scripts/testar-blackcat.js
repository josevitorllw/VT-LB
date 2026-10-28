// Testa a conexão com a BlackCat usando as chaves do .env.
//
//   npm run testar-blackcat -- "Seu Nome" 52998224725 voce@email.com 11912345678
//
// Cria UMA cobrança Pix de verdade (no valor do ebook) só para conferir a resposta.
// Ninguém é cobrado se você não pagar; o Pix expira sozinho.
// Se BLACKCAT_AUTH não estiver no .env, o teste experimenta as formas de autenticação
// uma por uma e diz qual funcionou.

process.env.PAYMENT_PROVIDER = 'blackcat';
const crypto = require('node:crypto');
const config = require('../src/config');
const blackcat = require('../src/payments/blackcat');

const [name, document, email, phone] = process.argv.slice(2);
const mask = (v) => (v ? `preenchida (${v.slice(0, 8)}…, ${v.length} caracteres)` : '(vazia)');

async function main() {
  const bc = config.blackcat;
  console.log('\n=== Teste da BlackCat ===');
  console.log('Endereço da API:', bc.apiUrl || '(vazio!)');
  console.log('Chave secreta:  ', mask(bc.secretKey));
  console.log('Chave pública:  ', mask(bc.publicKey));
  console.log('Link de aviso:  ', `${config.publicUrl}/api/webhooks/blackcat?secret=***`);
  if (!bc.apiUrl || !bc.secretKey) {
    console.log('\n❌ Preencha BLACKCAT_API_URL e BLACKCAT_SECRET_KEY no arquivo .env.');
    process.exit(1);
  }
  if (!name || !document || !email || !phone) {
    console.log('\nUso: npm run testar-blackcat -- "Seu Nome" CPF email celular');
    process.exit(1);
  }
  if (config.publicUrl.includes('localhost')) {
    console.log('\n⚠️  PUBLIC_URL ainda é localhost: a BlackCat não vai conseguir avisar o site quando o Pix for pago.');
  }

  // Formas a testar: a do .env (se definida) ou todas.
  const fixed = process.env.BLACKCAT_AUTH;
  const modes = fixed ? [fixed.toLowerCase()] : Object.keys(blackcat.AUTH_MODES)
    .filter((m) => bc.publicKey || !m.includes('public'));

  console.log(`\n1) Criando um Pix de ${(config.ebook.priceCents / 100).toFixed(2)} reais...`);
  let pix;
  let workingMode;
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
        console.log(`   • autenticação "${mode}": recusada`);
        continue;
      }
      console.log(`❌ Falhou (autenticação "${mode}"):`, err.message);
      if (err.body) console.log('   Resposta da BlackCat:', err.body);
      if (err.shape) console.log('   Estrutura da resposta (mande isto para ajustar):', err.shape);
      if (err.status === 401 || err.status === 403) console.log('   → A chave parece errada ou sem permissão.');
      if (err.status === 404) console.log('   → O endereço ou o caminho da API está errado (BLACKCAT_API_URL / BLACKCAT_CREATE_PATH).');
      if (err.status === 400 || err.status === 422) console.log('   → A autenticação passou, mas a BlackCat recusou os dados enviados. Mande a resposta acima para ajustar.');
      process.exit(1);
    }
  }
  if (!pix) {
    console.log('❌ Nenhuma forma de autenticação foi aceita. Confira se as chaves estão certas e se são de produção.');
    process.exit(1);
  }
  console.log(`✅ Pix criado! (autenticação "${workingMode}")`);
  console.log('   Id da transação:', pix.gatewayId);
  console.log('   Copia e cola:   ', `${pix.pixCode.slice(0, 30)}...`);

  console.log('\n2) Consultando o status...');
  try {
    const status = await blackcat.getStatus(pix.gatewayId);
    console.log(`✅ Status: ${status === 'pending' ? 'aguardando pagamento' : status}`);
  } catch (err) {
    console.log('❌ Falhou:', err.message);
    if (err.body) console.log('   Resposta da BlackCat:', err.body);
    if (err.status === 404) console.log('   → Confira o caminho BLACKCAT_STATUS_PATH no .env.');
    process.exit(1);
  }
  console.log('\n🎉 Tudo certo! Coloque estas linhas no .env e reinicie o site:');
  console.log(`   BLACKCAT_AUTH=${workingMode}`);
  console.log('   PAYMENT_PROVIDER=blackcat\n');
}

main();
