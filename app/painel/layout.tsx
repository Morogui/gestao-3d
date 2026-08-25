import type { Metadata } from "next";

export const metadata: Metadata = {
  icons: {
    icon: "/logo-7x7.png",
    shortcut: "/logo-7x7.png",
    apple: "/logo-7x7.png",
  },
};

export default function PainelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
