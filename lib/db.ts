// Cliente Postgres (Neon, via integração da Vercel) compartilhado por
// todas as rotas de API. A variável DATABASE_URL é injetada
// automaticamente pela Vercel (Settings → Environment Variables) quando
// o banco Neon está conectado ao projeto.
//
// Tabelas (ver docs/logica-producao-placas.md pro raciocínio completo):
// - machines: impressoras 3D cadastradas.
// - placas: catálogo de placas (peça direta ou corpo/gancho de um
//   produto composto), com peças/placa, tempo/placa e tier de demanda.
// - estoque_placas: contagem atual de peças em estoque por placa.
// - producoes: ordens de produção (em_andamento / concluida), uma placa
//   carregada em uma máquina; ao concluir, credita estoque_placas.
// - produtos / parametros_globais: substituem o antigo localStorage da
//   aba Custo (peça solta + parâmetros de custo).

import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  // Não derruba o build, mas deixa claro em runtime se faltar configurar.
  console.warn(
    "DATABASE_URL não configurada — as rotas de API que usam o banco vão falhar."
  );
}

// O driver HTTP do Neon usa fetch() por baixo dos panos, e o Next.js
// intercepta e cacheia chamadas fetch automaticamente — mesmo em rotas
// com `export const dynamic = "force-dynamic"`, em alguns casos esse
// cache "gruda" numa resposta antiga (ex: a lista de placas ficou
// travada em 32 registros mesmo depois de cadastrar mais 14 no banco).
// `cache: "no-store"` força toda query a ir direto no Postgres.
export const sql = neon(process.env.DATABASE_URL ?? "", {
  fetchOptions: { cache: "no-store" },
});
