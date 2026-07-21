# Catálogo de SKUs reais (fonte: planilha "PRECIFICAÇÃO CERTA", aba BASE)

Transcrito em 2026-07-21 de
https://docs.google.com/spreadsheets/d/1E9r04N7KhB_3zeahBCW6P5VbsJi-vJ8P-M8AQx8pHFY
(aba BASE, colunas SKU/Descrição/Peso/Comprimento/Largura/Altura), 117 linhas
(116 SKUs + cabeçalho). Usado como fonte da tabela `sku_placa` (mapeamento
SKU real → placa do catálogo de produção).

Ignorados (matéria-prima, não são peça impressa): FILAMENTO PETG BRANCO,
PRINTALOT BRANCO, PRINTALOT PRETO.

## Mapeamento SKU → placa

Placas já existentes no catálogo de 32 (ver `logica-producao-placas.md`),
por número:

- **#1 Suporte Secador de Cabelo**: SUPORTE SECADOR DE CABELO BRANCO,
  SUPORTE SECADOR DE CABELO BRANCO C PARAFUSO, SUPORTE SECADOR DE CABELO
  PRETO, SUPORTE SECADOR DE CABELO PRETO C PARAFUSO (qty 1 cada — parafuso
  é só embalagem, mesma peça física).
- **#2 Suporte Multigancho**: SUPORTE MULTIGANCHOS BRANCO, SUPORTE
  MULTIGANCHOS PRETO (qty 1).
- **#3 6X3 21 FATIAS**: 6X3 21 FATIAS BRANCO, 6X3 21 FATIAS PRETO (qty 1).
- **#4/#5 Suporte Universal (corpo/gancho)**: SUPORTE UNIVERSAL BRANCO,
  SUPORTE UNIVERSAL PRETO — cada SKU consome 1 peça de #4 E 1 peça de #5.
- **#6 Suporte Box 6mm (kit 1/2/3)**: 1/2/3 SUPORTE BOX 6MM BRANCO, 1/2/3
  SUPORTE BOX 6MM PRETO — qty = 1, 2 ou 3 conforme o número no SKU.
- **#7 6X3 14 FATIAS**: 6X3 14 FATIAS BRANCO, 6X3 14 FATIAS PRETO (qty 1).
- **#8/#9 Suporte Carro (corpo/gancho)**: SUPORTE CARRO BRANCO, SUPORTE
  CARRO CINZA, SUPORTE CARRO PRETO — cada SKU consome 1 peça de #8 E 1 de #9.
- **#10 6X3 15 FATIAS**: 6X3 15 FATIAS BRANCO, 6X3 15 FATIAS PRETO (qty 1).
- **#11 6X3 18 FATIAS**: 6X3 18 FATIAS BRANCO, 6X3 18 FATIAS PRETO (qty 1).
- **#12 Cortina (com/sem parafuso)**: PAR DE GANCHOS CORTINA COM PARAFUSO
  BRANCO/PRETO, PAR DE GANCHOS CORTINA SEM PARAFUSO BRANCO/PRETO — "par"
  assumido como 2 peças por venda (ajustável se a suposição estiver errada).
- **#13 STAM-01**: STAM-01 BEGE (qty 1).
- **#14 Suporte Orelha (kit 1/2/3)**: KIT 1/2/3 SUPORTE ORELHA (qty = número).
- **#15 Suporte para Garrafa Coração**: SUPORTE PARA GARRAFA CORACAO (qty 1).
- **#16 6X2 21 FATIAS**: 6X2 21 FATIAS BRANCO, 6X2 21 FATIAS PRETO (qty 1).
- **#17 Suporte Box 8mm (kit 1/2/3)**: 1/2/3 SUPORTE BOX 8MM BRANCO, 1/2/3
  SUPORTE BOX 8MM PRETO (qty = número).
- **#18 6X2.5 18 FATIAS**: 6X2.5 18 FATIAS BRANCO, 6X2.5 18 FATIAS PRETO.
- **#19 STAM-02**: STAM-02 BRANCO.
- **#20 6X2.5 21 FATIAS**: 6X2.5 21 FATIAS BRANCO, 6X2.5 21 FATIAS PRETO.
- **#21 6X2 18 FATIAS**: 6X2 18 FATIAS BRANCO, 6X2 18 FATIAS PRETO.
- **#22 7X2 21 FATIAS**: 7X2 21 FATIAS BRANCO, 7X2 21 FATIAS PRETO.
- **#23 Suporte Talher e Tampa**: SUPORTE TALHER E TAMPA.
- **#24 Gancho Branco (kit 1/2/3)**: KIT 1/2/3 GANCHO(S) BRANCO (qty = número).
- **#25 Suporte Controle PS5**: SUPORTE PS5 BRANCO, SUPORTE PS5 PRETO.
- **#26 Suporte 8 Pratos**: SUPORTE 8 PRATOS BRANCO/MARROM/PRETO.
- **#27 Ganchos Bonito (kit 1/2/3)**: KIT 1/2/3 GANCHOS BONITO (todas as
  variações branco/preto/com-sem-hífen encontradas na planilha), qty=número.
- **#28/#29 Suporte BMW (corpo/gancho)**: SUPORTE BMW BRANCO, SUPORTE BMW
  PRETO — cada SKU consome 1 peça de #28 E 1 de #29.
- **#30 Ganchos Simples (kit 1/2/3)**: KIT 1/2/3 GANCHOS SIMPLES.
- **#31 Suporte Notebook**: SUPORTE NOTEBOOK BRANCO/PRETO.
- **#32 Suporte 6 Pratos**: SUPORTE 6 PRATOS BRANCO/MARROM/PRETO.

## Placas novas (produtos vendidos mas fora do catálogo de 32)

Sem dados reais de peças/placa e tempo/placa (a planilha de preço não tem
essa informação) — cadastradas com placeholder (1 peça, 1h, tier C,
`dados_confirmados = false`) até o Guilherme confirmar os valores reais:

- **#33 Bandeja Suporte**: BANDEJA SUPORTE BRANCO/PRETO.
- **#34 Coelho 3D (kit 1/2/3)**: 1/2/3 COELHO 3D.
- **#35 Gancho Adesivo (kit 1/2/3)**: GPAN01/02/03-BR/-PR (01=kit1,
  02=kit2, 03=kit3, a julgar pela progressão de custo 0.41/0.82/1.23).
- **#36 Kit Taça e Figurinha 100un**: KIT TACA E FIGURINHA 100UN.
- **#37 Love decorativo**: LOVE.
- **#38 Suporte Cortina C**: SUPORTE CORTINA C BRANCO 1UN/2UN (produto
  distinto do #12 — é um suporte/bracket, não o par de ganchos).
- **#39 Pena P**: PENA P.
- **#40 Porta Copo Taça Copa do Mundo**: PORTA COPO TACA COPA DO MUNDO.
- **#41 Porta Lápis (kit 1/2/3)**: 1/2/3 PORTA LAPIS LARANJA/PRATA/PRETO —
  mesma peça em 3 cores, qty = número.
- **#42 Suporte Carregador BYD**: SUPORTE CARREGADOR BYD BRANCO/PRETO
  (produto distinto do #8/#9 "Suporte Carro" — molde próprio pra BYD).
- **#43 Suporte Controle TV**: SUPORTE CONTROLE TV, SUPORTE TV COM
  PARAFUSO (mesma peça, parafuso é variante de embalagem).
- **#44 Suporte Mangueira**: Suporte Mangueira Prata/Preto.
- **#45 Suporte Raquete de Tênis**: SUPORTE RAQUETE DE TENIS BRANCO/PRETO.
- **#46 Troféu Copa do Mundo**: TROFEU COPA DO MUNDO.

**Pendência**: pra essas 14 placas novas, confirmar peças/placa e
tempo/placa reais (hoje estão com placeholder 1 peça / 1h) e o Tier real
(hoje todas em C) — a tela de Produção já sinaliza visualmente quais
placas ainda não têm dados confirmados.
