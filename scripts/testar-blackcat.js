// Testa a conexão com a BlackCat usando a chave do .env.
//
//   npm run testar-blackcat -- "Seu Nome" 52998224725 voce@email.com 11912345678
//
// Cria UMA cobrança Pix de verdade (no valor do ebook) só para conferir a resposta.
// Ninguém é cobrado se você não pagar; o Pix expira sozinho.

process.env.PAYMENT_PROVIDER = 'blackcat';
const crypto = require('node:crypto');
const config = require('../src/config');
const blackcat = require('../src/payments/blackcat');

const [name, document, email, phone] = process.argv.slice(2);

async function main() {
  console.log('\n=== Teste da BlackCat ===');
  console.log('Endereço da API:', config.blackcat.apiUrl || '(vazio!)');
  console.log('Chave da API:   ', config.blackcat.apiKey ? `preenchida (${config.blackcat.apiKey.length} caracteres)` : '(vazia!)');
  console.log('Link de aviso:  ', `${config.publicUrl}/api/webhooks/blackcat?secret=***`);
  if (!config.blackcat.apiUrl || !config.blackcat.apiKey) {
    console.log('\n❌ Preencha BLACKCAT_API_URL e BLACKCAT_API_KEY no arquivo .env.');
    process.exit(1);
  }
  if (!name || !document || !email || !phone) {
    console.log('\nUso: npm run testar-blackcat -- "Seu Nome" CPF email celular');
    process.exit(1);
  }
  if (config.publicUrl.includes('localhost')) {
    console.log('\n⚠️  PUBLIC_URL ainda é localhost: a BlackCat não vai conseguir avisar o site quando o Pix for pago.');
  }

  console.log(`\n1) Criando um Pix de ${(config.ebook.priceCents / 100).toFixed(2)} reais...`);
  let pix;
  try {
    pix = await blackcat.createPix({
      id: crypto.randomUUID(), name, email, phone, document, amount_cents: config.ebook.priceCents,
    });
  } catch (err) {
    console.log('❌ Falhou:', err.message);
    if (err.body) console.log('   Resposta da BlackCat:', err.body);
    if (err.shape) console.log('   Estrutura da resposta (mande isto para ajustar):', err.shape);
    if (err.status === 401 || err.status === 403) console.log('   → A chave da API parece errada ou sem permissão.');
    if (err.status === 404) console.log('   → O endereço ou o caminho da API está errado (BLACKCAT_API_URL / BLACKCAT_CREATE_PATH).');
    process.exit(1);
  }
  console.log('✅ Pix criado!');
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
  console.log('\n🎉 Tudo certo! Pode mudar PAYMENT_PROVIDER=blackcat no .env.\n');
}

main();
