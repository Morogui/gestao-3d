# Gestão 3D

Sistema de gestão para produção e venda de produtos impressos em 3D, com três abas:

1. **Custo** — calculadora de custo de impressão (pronta, funcionando)
2. **Vendas** — integração com Mercado Livre (pronta), Shopee e TikTok Shop (futuro)
3. **Produção** — cruzamento de vendas x produtos cadastrados (MVP pronto)

Repositório: https://github.com/Morogui/gestao-3d
Produção: https://gestao-3d-ecru.vercel.app

## Aba Custo

Implementa a fórmula:

- Custo Filamento = (peso da placa em g ÷ 1000) × preço do filamento
- Custo Energia = tempo da placa (h) × energia (R$/h)
- Custo Manutenção = tempo da placa (h) × manutenção (R$/h)
- Custo da Placa = soma dos três acima
- Custo da Placa c/ Falha = Custo da Placa × (1 + falha de impressão)
- Custo unitário (por peça) = Custo da Placa c/ Falha ÷ peças na placa

A calculadora cobre o custo da peça solta. A montagem de kits/SKUs (várias
peças formando um produto vendido) é resolvida depois, cruzando o custo
unitário de cada peça com a composição do kit — isso entra na aba
Vendas/Produção, não aqui.

Parâmetros padrão (editáveis na tela): filamento R$ 75,40/kg, energia R$ 0,08/h,
manutenção R$ 0,30/h, falha de impressão 3%.

Os produtos cadastrados e os parâmetros ficam salvos no `localStorage` do
navegador por enquanto. Vale migrar pra um banco de dados compartilhado (ex:
Vercel Postgres/Neon) quando a aba Produção precisar cruzar esses dados no
servidor.

## Aba Vendas — Mercado Livre

Fluxo OAuth2 completo:

- `GET /api/mercadolivre/authorize` — manda o usuário pra tela de login/autorização da ML.
- `GET /api/mercadolivre/callback` — recebe o `code`, troca por `access_token`/`refresh_token` e guarda em cookies `httpOnly` (não acessíveis via JS no navegador).
- `POST /api/mercadolivre/webhook` — recebe notificações da ML (novo pedido, pagamento, etc) e responde 200 OK. Hoje só loga; pode evoluir pra processar eventos quando fizer sentido.
- `app/vendas/page.tsx` — Server Component que mostra "Conectar com Mercado Livre" se ainda não autenticado, ou a tabela de pedidos (comprador, itens, total, status, modalidade de envio) se já autenticado.

**Limitação atual**: se o `access_token` expirar (dura ~6h) e a chamada
falhar, a tela pede pra reconectar em vez de renovar sozinha via
`refresh_token` — isso porque Server Components não conseguem regravar
cookies. Pra automatizar a renovação, o próximo passo é mover a checagem
pra um Route Handler ou Middleware.

### Escopos ativados no app da ML (Morolar Produção)

- **Venda e envios de um produto** (Leitura) — pedidos e modalidade de envio, usado pela aba Vendas hoje.
- **Métricas do negócio** (Leitura) — indicadores de vendas/estoque/operação, reservado pra futura aba de Faturamento (produto mais vendido, sem venda em 15 dias, menor venda).
- **Faturamento de uma venda** (Leitura) — receitas, movimentações e saldos da conta, reservado pro mesmo painel futuro (valor vendido no dia, por plataforma e geral da conta).

Os demais escopos (Comunicações pré/pós-venda, Publicidade de um produto,
Promoções e cupons) continuam desligados — ativar só quando alguma
funcionalidade específica precisar.

**Pendência conhecida — foto do produto não aparece na aba Vendas**: o
endpoint que busca a foto (`/items` multiget) exige o escopo **Publicação
e sincronização** (Leitura), que ainda não está habilitado no app da ML —
por isso as chamadas retornam `403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES`.
Assim que o painel "Minhas aplicações" da ML (que está fora do ar) voltar,
habilitar esse escopo e reconectar a conta na aba Vendas pra gerar um
token novo com essa permissão.

## Aba Produção

Cruza os pedidos do dia (mesma fonte de dados da aba Vendas, via
`GET /api/mercadolivre/orders?data=YYYY-MM-DD`) com os produtos
cadastrados na aba Custo, e mostra:

- quantas peças de cada produto cadastrado precisam ser impressas;
- o custo estimado (unitário × quantidade), usando a fórmula da aba Custo;
- os itens vendidos que não bateram com nenhum produto cadastrado, pra
  você cadastrar.

**Como funciona a casada produto ↔ item vendido**: como os produtos do
Custo só existem no `localStorage` do navegador (não no servidor), o
cruzamento roda no cliente (`lib/producao.ts`). A comparação é por nome:
o "Nome/código" cadastrado no Custo precisa aparecer no título do anúncio
da ML (ou ser igual ao SKU customizado do item, se você preencher esse
campo na ML com o mesmo nome/código). Itens sem produto cadastrado
aparecem separados, com a sugestão de cadastrá-los.

**Limitação atual**: não existe controle de "já produzido" — a fila
mostra tudo que foi vendido no dia selecionado, sem marcar o que já foi
impresso. Pra isso (e pra deixar a casada produto↔item mais robusta),
o próximo passo é migrar o cadastro de produtos do Custo pra um banco de
dados compartilhado.

### Variáveis de ambiente necessárias

Ver `.env.example`. Resumo:

| Variável | Onde configurar | Valor |
|---|---|---|
| `ML_CLIENT_ID` | Vercel + `.env.local` | Client ID do app na ML |
| `ML_CLIENT_SECRET` | Vercel + `.env.local` | Chave secreta do app (nunca commitar) |
| `ML_REDIRECT_URI` | Vercel + `.env.local` | Precisa ser idêntico ao Redirect URI cadastrado na ML |

**Importante — lembrete para quando trocar de domínio**: o valor de
`ML_REDIRECT_URI` e o Redirect URI cadastrado no app da ML (em
developers.mercadolivre.com.br) precisam ser sempre idênticos. Hoje ambos
apontam pra `https://gestao-3d-ecru.vercel.app/api/mercadolivre/callback`.
Quando um domínio próprio for configurado (ex: `app.morolar.com.br`), os
dois lugares precisam ser atualizados juntos — senão o login com o
Mercado Livre para de funcionar.

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # depois preencha os valores reais
npm run dev
```

Acesse `http://localhost:3000` (redireciona para `/custo`). Pra testar a
aba Vendas localmente, use `ML_REDIRECT_URI=http://localhost:3000/api/mercadolivre/callback`
e cadastre esse mesmo valor como um Redirect URI adicional no app da ML.

## Publicando alterações (GitHub + Vercel)

Já está tudo conectado: `github.com/Morogui/gestao-3d` → import automático
na Vercel. Cada novo commit/upload na branch `main` do GitHub dispara um
novo deploy sozinho.

Pra subir mudanças sem git instalado: no GitHub, abra o repositório →
"Add file" → "Upload files" → arraste os arquivos alterados → "Commit changes".

## Próximos passos

- Aba Vendas: adicionar Shopee (API em aprovação) e depois TikTok Shop.
- Aba Vendas: automatizar a renovação do access_token via refresh_token.
- Aba Vendas: habilitar o escopo "Publicação e sincronização" no app da ML pra corrigir a foto do produto (ver pendência acima).
- Aba Produção: marcar itens como "já produzido" (precisa de banco de dados compartilhado, já que o Custo hoje só existe em localStorage).
- Futura aba de Faturamento/Métricas: valor vendido no dia (por plataforma e geral da conta), produtos mais vendidos, produtos sem venda nos últimos 15 dias, produtos com menor venda — usando os escopos "Métricas do negócio" e "Faturamento de uma venda" já habilitados na ML.
