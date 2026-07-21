"use client";

import { useState } from "react";

// Componente client só pra poder tratar erro de carregamento da imagem
// (ex: link da ML expirado/bloqueado) e cair no placeholder cinza em vez
// de mostrar o ícone de imagem quebrada do navegador.
export default function ItemThumbnail({
  src,
  alt,
}: {
  src: string | null;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="h-9 w-9 flex-shrink-0 rounded border border-gray-200 bg-gray-100" />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={36}
      height={36}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-9 w-9 flex-shrink-0 rounded border border-gray-200 object-cover"
    />
  );
}
