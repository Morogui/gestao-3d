// Cruza os pedidos da aba Vendas com os produtos cadastrados na aba
// Custo pra montar a fila de produção (o que precisa ser impresso).
//
// Como os produtos do Custo hoje só existem no localStorage do navegador
// (ver lib/storage.ts), esse cruzamento roda no cliente: a página de
// Produção busca os pedidos via /api/mercadolivre/orders (JSON) e casa
// cada item vendido com um produto cadastrado.
//
// A casada é por nome: comparamos o "Nome/código" cadastrado no Custo
// com o título do anúncio da ML (e com o SKU do item, caso o vendedor
// preencha o SKU customizado com esse mesmo nome/código). É uma
// heurística — funciona bem quando o nome cadastrado aparece no título
// do anúncio. Itens que não baterem aparecem separados, pra cadastrar.

import { GlobalParams, ProdutoInput, calcularCusto } from "./custo";
import { OrderItemSummary, OrderSummary } from "./ml-orders";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export interface ItemParaImprimir {
  produto: ProdutoInput | null;
  chave: string;
  titulo: string;
  quantidade: number;
  custoUnitario: number;
  custoTotal: number;
}

function encontrarProduto(
  item: OrderItemSummary,
  produtos: ProdutoInput[]
): ProdutoInput | null {
  const titulo = normalize(item.title);
  const sku = normalize(item.sku);
  return (
    produtos.find((p) => {
      const nome = normalize(p.nome);
      if (!nome) return false;
      return nome === sku || titulo.includes(nome) || nome.includes(titulo);
    }) ?? null
  );
}

export interface FilaDeProducao {
  casados: ItemParaImprimir[];
  semCadastro: ItemParaImprimir[];
}

export function calcularFilaDeProducao(
  orders: OrderSummary[],
  produtos: ProdutoInput[],
  params: GlobalParams
): FilaDeProducao {
  const mapa = new Map<string, ItemParaImprimir>();

  for (const order of orders) {
    for (const item of order.items) {
      const produto = encontrarProduto(item, produtos);
      const chave = produto ? `produto:${produto.id}` : `titulo:${normalize(item.title)}`;
      const custoUnitario = produto
        ? calcularCusto(produto, params).custoUnitario
        : 0;

      const existente = mapa.get(chave);
      if (existente) {
        existente.quantidade += item.quantity;
        existente.custoTotal = existente.custoUnitario * existente.quantidade;
      } else {
        mapa.set(chave, {
          produto,
          chave,
          titulo: produto ? produto.nome : item.title,
          quantidade: item.quantity,
          custoUnitario,
          custoTotal: custoUnitario * item.quantity,
        });
      }
    }
  }

  const todos = Array.from(mapa.values()).sort(
    (a, b) => b.quantidade - a.quantidade
  );

  return {
    casados: todos.filter((i) => i.produto !== null),
    semCadastro: todos.filter((i) => i.produto === null),
  };
}
