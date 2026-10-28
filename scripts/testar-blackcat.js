// Testa a conexão com a BlackCat usando as chaves do .env.
//
//   npm run testar-blackcat -- "Seu Nome" 52998224725 voce@email.com 11912345678
//
// Na Railway, use o botão "Testar conexão com a BlackCat" do painel /admin (faz o mesmo teste).

const { runBlackcatTest } = require('../src/payments/blackcatTest');

const [name, document, email, phone] = process.argv.slice(2);
if (!name || !document || !email || !phone) {
  console.log('Uso: npm run testar-blackcat -- "Seu Nome" CPF email celular');
  process.exit(1);
}

runBlackcatTest({ name, document, email, phone }).then(({ ok, lines }) => {
  console.log(`\n${lines.join('\n')}\n`);
  process.exit(ok ? 0 : 1);
});
