# Gestão 3D

Sistema de gestão para produção e venda de produtos impressos em 3D, com três abas:

1. **Custo** — calculadora de custo de impressão (pronta, funcionando)
2. **Vendas** — integração futura com Mercado Livre, Shopee e TikTok Shop (placeholder)
3. **Produção** — cruzamento de vendas x produtos cadastrados (placeholder)

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

Cada produto tem um único campo de identificação (nome/código), usado tanto
para exibir quanto para futuras buscas por nome ou SKU.

Os produtos cadastrados e os parâmetros ficam salvos no `localStorage` do
navegador por enquanto. Quando as abas Vendas/Produção entrarem em produção
(integrações via API rodando no servidor), vale migrar esse cadastro para um
banco de dados compartilhado (ex: Postgres via Vercel Postgres/Neon), já que
localStorage só existe no navegador de quem acessa.

## Rodando localmente

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000` (redireciona para `/custo`).

## Publicando no GitHub

```bash
git init
git add .
git commit -m "Setup inicial: aba Custo"
git branch -M main
git remote add origin <URL_DO_SEU_REPOSITORIO>
git push -u origin main
```

## Publicando na Vercel

1. Acesse [vercel.com](https://vercel.com) e faça login com a conta do GitHub.
2. Clique em "Add New… → Project" e selecione o repositório.
3. A Vercel detecta automaticamente que é um projeto Next.js — não precisa
   mudar nenhuma configuração de build.
4. Clique em "Deploy". Em poucos minutos o projeto fica disponível numa URL
   pública (e em cada novo push no `main` ele atualiza sozinho).

## Próximos passos

- Aba Vendas: integrar API do Mercado Livre (OAuth + endpoint de pedidos),
  depois Shopee, depois TikTok Shop. As credenciais devem ficar em variáveis
  de ambiente (`.env.local` local / "Environment Variables" na Vercel) e as
  chamadas de API devem rodar em API Routes do Next.js, nunca no navegador.
- Aba Produção: consumir os pedidos da aba Vendas e cruzar com os produtos
  cadastrados na aba Custo para gerar a lista do que precisa ser impresso.
