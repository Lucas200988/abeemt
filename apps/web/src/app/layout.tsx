import type { Metadata } from 'next';
import './globals.css';

const marca = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Borá Carregar';

export const metadata: Metadata = {
  title: `${marca} — Painel`,
  description: 'Painel administrativo de monetização de carregadores OCPP.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // lang pt-BR: o painel é inteiramente em português (briefing seção 14).
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
