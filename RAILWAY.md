# Colocar o site no ar pela Railway

Tempo: uns 15 minutos. Custo: o plano Hobby da Railway (cerca de US$ 5 por mês).

## 1. Criar o projeto

1. Entre em **https://railway.com** e clique em **Login** → **Login with GitHub** (use a conta `josevitorllw`).
2. Clique em **New Project** → **Deploy from GitHub repo**.
   - Se pedir, clique em **Configure GitHub App** e libere o repositório **VT-LB**.
3. Escolha **josevitorllw/VT-LB**. A Railway começa a montar o site.

## 2. Escolher o ramo (branch) certo

O código do site está no ramo `claude/jolly-dijkstra-6dqbmb` (o `main` ainda só tem o README).

1. Clique no serviço (o quadrado **VT-LB**) → aba **Settings**.
2. Em **Source** → **Branch connected to production**, troque para `claude/jolly-dijkstra-6dqbmb`.

> Se o código for levado para o `main` (pull request aprovado), volte esta opção para `main`.

## 3. Criar o volume (onde ficam os dados)

Sem volume, **as vendas, os cadastros e os arquivos são apagados** a cada atualização.

1. No quadro do projeto, clique com o botão direito em um espaço vazio (ou aperte `Ctrl+K`) → **Volume** / **Add Volume**.
2. Escolha o serviço **VT-LB** e use o caminho (**Mount path**) `/data`.

O site percebe o volume sozinho; não precisa configurar mais nada.

## 4. Variáveis (configurações do site)

No serviço → aba **Variables** → **Raw Editor**, cole e preencha:

```
ADMIN_PASSWORD=uma-senha-forte-so-sua
WEBHOOK_SECRET=um-texto-longo-e-aleatorio-sem-espacos
EBOOK_TITLE=Nome do seu ebook
EBOOK_SUBTITLE=Uma frase sobre o ebook
EBOOK_PRICE_CENTS=4790
PRIZE_TITLE=Nome do prêmio
PRIZE_DESCRIPTION=Parabéns! Seu cadastro foi confirmado.

BLACKCAT_API_URL=https://api.blackcatpay.com.br
BLACKCAT_SECRET_KEY=sk_live_...
BLACKCAT_PUBLIC_KEY=pk_live_...
```

- `EBOOK_PRICE_CENTS` é em centavos: `4790` = R$ 47,90.
- **Ainda não coloque** `PAYMENT_PROVIDER`. Sem ele, o site fica no ar com as **vendas fechadas** (ninguém compra)
  até a BlackCat ser testada no passo 7.
- Clique em **Update Variables** / **Deploy** para aplicar.

## 5. Gerar o endereço do site

Serviço → **Settings** → **Networking** → **Generate Domain**.
Vai aparecer algo como `https://vt-lb-production.up.railway.app`. Esse é o seu site.

(Para usar um domínio próprio, como `seusite.com.br`, use **Custom Domain** nessa mesma tela e siga as instruções
de DNS. Depois adicione a variável `PUBLIC_URL=https://seusite.com.br`.)

## 6. Enviar o ebook, o prêmio e a foto

1. Abra `https://SEU-ENDERECO/admin` → usuário **admin**, senha = a sua `ADMIN_PASSWORD`.
2. Em **📁 Arquivos do site**, envie o **ebook (PDF)**, o **prêmio** e a **foto da página inicial**.

## 7. Testar a BlackCat e abrir as vendas

1. Ainda no `/admin`, em **🔌 Testar conexão com a BlackCat**, preencha seus dados e clique em **Testar conexão**.
2. Se aparecer **🎉 Tudo certo!**, adicione nas **Variables** as duas linhas que o teste mostrar, por exemplo:
   ```
   BLACKCAT_AUTH=x-api-key
   PAYMENT_PROVIDER=blackcat
   ```
3. Se der erro, copie o texto do resultado e mande para ajustar (ele não mostra as chaves inteiras).
4. Faça uma **compra real de valor baixo** (baixe o `EBOOK_PRICE_CENTS` temporariamente, ex.: `500`),
   pague o Pix e confira se o ebook é liberado sozinho. Depois volte o preço.

Pronto: o site está vendendo. 🎉

## Dúvidas comuns

- **O site não abre / deu erro no deploy:** serviço → aba **Deployments** → clique no último → **View logs**.
- **Quero testar o fluxo inteiro no ar sem pagar:** adicione `ALLOW_SIMULATE=true` (aparece o botão
  "Simular pagamento"). **Tire antes de divulgar**, senão qualquer pessoa pega o ebook de graça.
- **Backup:** no `/admin`, baixe as planilhas de cadastros e vendas de tempos em tempos.
