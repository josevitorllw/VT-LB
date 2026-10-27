# VT-LB

Site de venda de ebook com Pix (BlackCat), certificado e resgate de prêmio.

## Como funciona

1. **Compra** (`/`): a pessoa preenche nome, e-mail, celular e CPF e recebe um Pix (QR Code + copia e cola).
2. **Pagamento confirmado** (`/pedido/...`): a página atualiza sozinha. Depois do pagamento, aparecem:
   - o botão para **baixar o ebook**;
   - o **código do certificado** (ex.: `VTLB-8F3K-2Q9X`);
   - o link para o **certificado** com o nome da pessoa (dá para imprimir ou salvar em PDF).
3. **Prêmio** (`/premio`): a pessoa digita o código do certificado e o e-mail da compra, e o prêmio é liberado.
   Cada certificado vale um prêmio só. Se a pessoa voltar depois, vê o mesmo prêmio de novo, mas não ganha outro.

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

- `ebook.pdf`: o ebook;
- `premio.pdf`: o prêmio (opcional; se não houver arquivo, a página só mostra a mensagem do prêmio).

Esses arquivos **não vão para o GitHub** (estão no `.gitignore`) e só podem ser baixados por links exclusivos
de quem pagou ou resgatou o prêmio.

Título, preço (em centavos: `4790` = R$ 47,90) e texto do prêmio ficam no `.env`.

## Ligar a BlackCat (cobrança de verdade)

1. No painel da BlackCat, gere sua **chave de API**.
2. No `.env`:
   ```
   PAYMENT_PROVIDER=blackcat
   BLACKCAT_API_KEY=sua-chave
   PUBLIC_URL=https://seu-site.com.br
   WEBHOOK_SECRET=um-texto-longo-e-aleatorio
   ```
3. Confira na documentação da BlackCat se o endereço da API (`BLACKCAT_API_URL`) e os caminhos
   (`BLACKCAT_CREATE_PATH`, `BLACKCAT_STATUS_PATH`) estão iguais aos do `.env.example`. Se os nomes dos campos
   forem diferentes, ajuste **só** o arquivo `src/payments/blackcat.js`.
4. O site informa à BlackCat, em cada cobrança, o link de notificação:
   `https://seu-site.com.br/api/webhooks/blackcat?secret=SEU_WEBHOOK_SECRET`.
   Por segurança, o site não confia no conteúdo da notificação: ele sempre consulta a BlackCat para confirmar
   o pagamento antes de liberar o ebook.
5. Faça uma compra real de valor baixo para testar antes de divulgar.

## Hospedagem

O site precisa de um servidor Node.js (não funciona no GitHub Pages). Opções simples: Railway, Render ou uma VPS.
Os pedidos ficam salvos em `data/loja.db` (SQLite); use um disco persistente e faça backup desse arquivo.

## Estrutura

```
src/server.js            rotas e regras (pedidos, webhook, certificado, prêmio)
src/payments/blackcat.js integração com a BlackCat
src/payments/mock.js     modo de teste
src/db.js                banco de dados (SQLite)
public/                  páginas: index, pedido, certificado, prêmio
private/                 ebook e prêmio (protegidos)
```
