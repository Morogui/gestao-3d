import { notFound } from "next/navigation";
import { getCliente } from "@/lib/clients";
import ClienteChrome from "@/components/ClienteChrome";

// Layout raiz de toda area de cliente externo (/[cliente]/...). Busca o
// cliente pelo slug da URL e renderiza o chrome proprio dele (nome +
// nav com so as abas liberadas) -- totalmente separado do chrome da
// Morolar (ver components/AppChrome.tsx, que ja ignora essas rotas).
// Pedido do Guilherme em 2026-09-14.
export default async function ClienteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { cliente: string };
}) {
  const cliente = await getCliente(params.cliente);
  if (!cliente) {
    notFound();
  }

  return (
    <ClienteChrome nome={cliente!.nome} slug={params.cliente} abas={cliente!.abasPermitidas}>
      {children}
    </ClienteChrome>
  );
}
