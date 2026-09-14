"use client";

import { useRouter } from "next/navigation";

export default function ClienteLogoutButton({ slug }: { slug: string }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/cliente-logout", { method: "POST" });
    router.push(`/${slug}/login`);
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      style={{
        background: "transparent",
        border: "1px solid #334155",
        color: "#94a3b8",
        borderRadius: 6,
        padding: "6px 12px",
        cursor: "pointer",
      }}
    >
      Sair
    </button>
  );
}
