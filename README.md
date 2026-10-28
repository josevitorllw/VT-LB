# VT-LB

Site de venda de ebook com Pix (BlackCat), certificado e resgate de prêmio.

## Como funciona

1. **Início** (`/`): foto, título, texto e o botão **Fazer meu cadastro**.
2. **Cadastro** (`/cadastro`): a pessoa **anexa o certificado** (PDF) e informa **nome e CPF**.
   Quem ainda não tem certificado clica em **Comprar certificado**.
3. **Certificado** (`/comprar`): valor e formulário para gerar o **Pix**.
4. **Pagamento confirmado** (`/pedido/...`): a página atualiza sozinha e libera o download do
   **ebook com o certificado na primeira página** (com o nome da pessoa e um código exclusivo, ex.: `VTLB-8F3K-2Q9X`).
   Um botão leva de volta ao cadastro.
5. No cadastro, o site confere se o PDF anexado é um certificado emitido pelo site e se pertence ao **CPF** de
   quem comprou.
6. Certificado aceito: aparece a tela **"Complete seus dados"** com **5 campos**. Depois de preenchidos, o
   **prêmio** é liberado. Cada certificado vale um prêmio só.

O código do certificado fica gravado dentro do PDF. Por isso a pessoa precisa anexar o **mesmo arquivo que baixou**,
sem editar (um print ou uma foto do certificado não é aceito).

## Rodar no computador

Precisa do [Node.js](https://nodejs.org) 22.13 ou mais novo.

```bash
npm install
cp .env.example .env   # depois edite o .env
npm start
```

Abra http://localhost:3000.

Por padrão o site roda em **modo de teste** (`PAYMENT_PROVIDER=mock`): nenhuma cobrança é feita, e a página do
pedido mostra um botão **"Simular pagamento"** para testar o fluxo completo.

## Seus arquivos

Coloque na pasta `private/`:

- `ebook.pdf`: o ebook (o site junta o certificado de cada comprador na primeira página);
- `premio.pdf`: o prêmio (opcional; se não houver arquivo, a página só mostra a mensagem do prêmio).

Esses arquivos **não vão para o GitHub** (estão no `.gitignore`) e só podem ser baixados por links exclusivos
de quem pagou ou resgatou o prêmio.

Título, preço (em centavos: `4790` = R$ 47,90) e texto do prêmio ficam no `.env`.

## Os 5 dados do cadastro

Os campos ficam no arquivo `src/campos.js`. Para trocar um campo, mude o `label` (o texto que aparece) e o `tipo`
(`texto`, `telefone`, `email`, `data`, `numero`, `opcoes` ou `texto-longo`). Dá para ter mais ou menos de 5.

## Painel: ver cadastros e vendas

1. No `.env`, coloque uma senha forte em `ADMIN_PASSWORD` e reinicie o site.
2. Acesse `https://seu-site.com.br/admin` com usuário **admin** e a senha que você escolheu.
3. Lá aparecem os totais, a lista de **cadastros** (com os 5 dados) e a lista de **vendas**.
   O botão **Baixar planilha** gera um arquivo que abre no Excel ou no Google Planilhas.

Esses dados são pessoais (CPF, telefone, data de nascimento...). Não compartilhe a senha do painel e trate os
dados de acordo com a LGPD: use só para o que você informou às pessoas.

## Foto e textos da página inicial

- **Foto:** coloque a imagem em `public/img/capa.jpg`.
- **Textos:** abra `public/index.html` e troque os textos entre `[colchetes]` pelos seus.
  Para destacar uma parte em vermelho, use `<mark>texto</mark>`.

## Ligar a BlackCat (cobrança de verdade)

1. No painel da BlackCat, gere sua **chave de API** (normalmente em Integrações / API / Credenciais).
   **Nunca** coloque a chave no GitHub nem mande por chat: ela fica só no `.env` (ou nas variáveis da hospedagem).
2. Preencha no `.env`:
   ```
   BLACKCAT_API_URL=https://api.blackcatpay.com.br   # confira no painel/documentação da BlackCat
   BLACKCAT_SECRET_KEY=sk_live_...                   # chave secreta
   BLACKCAT_PUBLIC_KEY=pk_live_...                   # chave pública
   PUBLIC_URL=https://seu-site.com.br                # endereço público do site, sem barra no final
   WEBHOOK_SECRET=um-texto-longo-e-aleatorio
   ```
3. Teste a conexão (cria um Pix de verdade, que expira sozinho se ninguém pagar):
   ```bash
   npm run testar-blackcat -- "Seu Nome" SEUCPF seu@email.com 11912345678
   ```
   - O teste experimenta as formas de autenticação e, no fim, diz a linha `BLACKCAT_AUTH=...` para colocar no `.env`.
   - `✅ Tudo certo!`: pode seguir.
   - `401/403`: chave errada. `404`: endereço ou caminho da API errado (`BLACKCAT_API_URL`, `BLACKCAT_CREATE_PATH`,
     `BLACKCAT_STATUS_PATH`).
   - "Estrutura da resposta": a BlackCat respondeu num formato diferente; mande essa linha (ela não tem dados
     pessoais) para ajustar `src/payments/blackcat.js`.
4. Coloque no `.env` a linha `BLACKCAT_AUTH=...` que o teste mostrou, mude `PAYMENT_PROVIDER=blackcat` e reinicie o site.
5. Faça uma compra real de valor baixo (dá para baixar o preço temporariamente em `EBOOK_PRICE_CENTS`) e confira se o
   ebook é liberado sozinho depois do Pix.

Como o site sabe que o Pix foi pago:
- a cada cobrança, ele informa à BlackCat o link de aviso `https://seu-site.com.br/api/webhooks/blackcat?secret=...`;
- além disso, a página do pedido consulta a BlackCat a cada 5 segundos enquanto a pessoa espera;
- em qualquer caso, o site confirma o status direto na BlackCat antes de liberar o ebook (um aviso falso não libera nada).

## Hospedagem

O site precisa de um servidor Node.js (não funciona no GitHub Pages). Opções simples: Railway, Render ou uma VPS.
Os pedidos ficam salvos em `data/loja.db` (SQLite); use um disco persistente e faça backup desse arquivo.

## Estrutura

```
src/server.js            rotas e regras (pedidos, webhook, certificado, prêmio)
src/payments/blackcat.js integração com a BlackCat
src/payments/mock.js     modo de teste
src/db.js                banco de dados (SQLite)
src/certificatePdf.js    gera o PDF ebook + certificado e lê o código no cadastro
src/campos.js            os 5 dados pedidos depois do certificado
src/admin.js             painel /admin (cadastros, vendas e planilhas)
public/                  páginas: início, cadastro, comprar, pedido
private/                 ebook e prêmio (protegidos)
```
