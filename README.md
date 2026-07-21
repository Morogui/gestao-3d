# Gestão 3D

Sistema de gestão para produção e venda de produtos impressos em 3D, com três abas:

1. **Custo** — calculadora de custo de impressão (pronta, funcionando)
2. **Vendas** — integração com Mercado Livre (pronta), Shopee e TikTok Shop (futuro)
3. **Produção** — estoque de placas, tiers de demanda e ordens de produção
   (com banco de dados Postgres — ver seção "Banco de dados" abaixo)

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

Os produtos cadastrados e os parâmetros ficam salvos no banco de dados
(Postgres via Neon/Vercel — ver seção "Banco de dados" abaixo), nas tabelas
`produtos` e `parametros_globais`, através das rotas `/api/produtos` e
`/api/parametros`. Isso corrige a limitação antiga (dados só existiam no
navegador de quem cadastrou) e é o que permite a aba Produção cruzar esses
dados no servidor.

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

## Banco de dados (Postgres via Neon/Vercel)

O projeto usa um banco Postgres provisionado pela integração Neon da
Vercel (Storage → neon-citron-lever), conectado ao projeto com a
variável `DATABASE_URL` (injetada automaticamente em produção). O
cliente fica em `lib/db.ts` (`@neondatabase/serverless`).

Tabelas:

- `produtos` / `parametros_globais` — substituem o antigo localStorage
  da aba Custo (peça solta + parâmetros de custo).
- `machines` — as impressoras 3D cadastradas (hoje: Impressora 1 a 4 —
  edite direto no banco se os nomes reais forem outros).
- `placas` — catálogo oficial de 32 placas (peça direta, ou corpo/gancho
  de um produto composto), com peças/placa, tempo/placa e Tier de
  demanda (A/B/C). Fonte: `docs/logica-producao-placas.md`, transcrito
  do documento de lógica de produção compartilhado.
- `estoque_placas` — contagem atual de peças em estoque por placa.
- `producoes` — ordens de produção (uma placa carregada em uma
  máquina); ao marcar como concluída, credita `estoque_placas`.

## Aba Produção

Painel de estoque e produção, cruzando o catálogo de placas com as
vendas dos últimos 7 dias (mesma fonte de dados da aba Vendas):

- **Produções em andamento**: o que está carregado em cada máquina
  agora, com botão para marcar como concluída (credita o estoque) ou
  cancelar.
- **Estoque de placas e recomendação de produção**: pra cada placa,
  mostra estoque atual, estoque "vendável" do par corpo+gancho (o
  menor dos dois lados), quanto foi vendido nos últimos 7 dias, quanto
  disso foi vendido no Full, e quanto falta produzir pra cobrir a meta
  do Tier (A produz 2.0x a demanda semanal, B 1.3x, C 1.0x). Cada linha
  tem um formulário rápido pra carregar a placa numa máquina.
- **Lembrete Full**: total vendido no Full na semana, já que essas
  vendas não descontam o estoque local mas precisam ser repostas no
  próximo envio (a montagem do Full é toda segunda-feira).
- **Histórico recente**: últimas produções concluídas/canceladas.

**Simplificação assumida (v1)**: pra placas compostas, a demanda
semanal é aplicada igualmente aos dois lados do par (corpo e gancho),
assumindo proporção 1:1 por unidade vendida — se um produto específico
precisar de mais peças de um lado que do outro, ajuste a quantidade na
hora de carregar a placa. A janela de turnos/corte de carregamento
(seção 4 do documento de lógica) ainda não está automatizada — fica
como leitura de referência em `docs/logica-producao-placas.md`.

**Como funciona o cruzamento venda ↔ placa**: por nome — o texto
cadastrado em `sku_ou_kit` de cada placa precisa aparecer no título do
anúncio da ML (ou no SKU customizado do item). Ver `lib/demanda.ts`.

### Variáveis de ambiente necessárias

Ver `.env.example`. Resumo:

| Variável | Onde configurar | Valor |
|---|---|---|
| `ML_CLIENT_ID` | Vercel + `.env.local` | Client ID do app na ML |
| `ML_CLIENT_SECRET` | Vercel + `.env.local` | Chave secreta do app (nunca commitar) |
| `ML_REDIRECT_URI` | Vercel + `.env.local` | Precisa ser idêntico ao Redirect URI cadastrado na ML |
| `DATABASE_URL` | Vercel (automático) + `.env.local` | Conexão do Postgres (Neon) — a Vercel injeta sozinha em produção |

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
- Aba Produção: confirmar os nomes reais das 4 máquinas (hoje cadastradas como "Impressora 1" a "4" — editar direto na tabela `machines` do banco).
- Aba Produção: automatizar a janela de turnos/corte de carregamento (seção 4 do documento de lógica) — hoje é só leitura de referência.
- Aba Produção: refinar a recomendação de Full replenishment com o exemplo real do documento (frete #72430222) em vez do total simples da semana.
- Aba Produção: se a proporção corpo:gancho de algum produto não for 1:1, ajustar `lib/demanda.ts` pra esse caso específico.
- Futura aba de Faturamento/Métricas: valor vendido no dia (por plataforma e geral da conta), produtos mais vendidos, produtos sem venda nos últimos 15 dias, produtos com menor venda — usando os escopos "Métricas do negócio" e "Faturamento de uma venda" já habilitados na ML.
