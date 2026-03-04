import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Planejamento de Produção - Liebe",
  description: "Sistema de planejamento de produção com estoque mínimo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
