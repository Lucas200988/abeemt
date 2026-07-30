'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api, clearSession, loadSession, type AuthenticatedUser } from '@/lib/api';

const MARCA = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Borá Carregar';

const ITENS = [
  { href: '/painel', label: 'Visão geral' },
  { href: '/painel/carregadores', label: 'Carregadores' },
  { href: '/painel/sessoes', label: 'Sessões' },
  { href: '/painel/pagamentos', label: 'Pagamentos' },
  { href: '/painel/estabelecimentos', label: 'Estabelecimentos' },
  { href: '/painel/diagnostico', label: 'Diagnóstico' },
];

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [usuario, setUsuario] = useState<AuthenticatedUser | null>(null);
  const [verificando, setVerificando] = useState(true);

  useEffect(() => {
    if (!loadSession()) {
      router.replace('/');
      return;
    }

    // Confirma a sessão contra a API: o token pode ter sido revogado desde que
    // foi guardado (a estratégia JWT revalida o usuário a cada requisição).
    api
      .me()
      .then(setUsuario)
      .catch(() => {
        clearSession();
        router.replace('/');
      })
      .finally(() => setVerificando(false));
  }, [router]);

  async function sair() {
    const sessao = loadSession();
    if (sessao) {
      // Revoga no servidor; se falhar, limpamos localmente de todo jeito.
      await api.logout(sessao.refreshToken).catch(() => undefined);
    }
    clearSession();
    router.replace('/');
  }

  if (verificando) {
    return (
      <main className="tela-centralizada">
        <p style={{ color: 'var(--texto-suave)' }}>Carregando…</p>
      </main>
    );
  }

  if (!usuario) return null;

  const [primeira, ...resto] = MARCA.split(' ');

  return (
    <div className="layout">
      <aside className="lateral">
        <div className="marca">
          {primeira} <span>{resto.join(' ')}</span>
        </div>

        <nav>
          {ITENS.map((item) => {
            // "/painel" só fica ativo na própria página, senão ficaria aceso
            // em todas as rotas filhas.
            const ativo =
              item.href === '/painel' ? pathname === '/painel' : pathname.startsWith(item.href);

            return (
              <Link key={item.href} href={item.href} className={ativo ? 'ativo' : undefined}>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="rodape">
          <div className="nome">{usuario.name}</div>
          <div className="papel">{usuario.roleLabel}</div>
          <button onClick={sair}>Sair</button>
        </div>
      </aside>

      <main className="principal">{children}</main>
    </div>
  );
}
