'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearSession, loadSession, type AuthenticatedUser } from '@/lib/api';

const MARCA = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Borá Carregar';

export default function PainelPage() {
  const router = useRouter();
  const [usuario, setUsuario] = useState<AuthenticatedUser | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    const sessao = loadSession();
    if (!sessao) {
      router.replace('/');
      return;
    }

    // Confirma a sessão contra a API: o token pode ter sido revogado desde
    // que foi guardado.
    api
      .me()
      .then(setUsuario)
      .catch(() => {
        clearSession();
        router.replace('/');
      })
      .finally(() => setCarregando(false));
  }, [router]);

  async function sair() {
    const sessao = loadSession();
    if (sessao) {
      // Revoga do lado do servidor; se falhar, limpamos localmente de todo jeito.
      await api.logout(sessao.refreshToken).catch(() => undefined);
    }
    clearSession();
    router.replace('/');
  }

  if (carregando) {
    return (
      <main className="tela-centralizada">
        <p style={{ color: 'var(--texto-suave)' }}>Carregando…</p>
      </main>
    );
  }

  if (!usuario) return null;

  const [primeiraPalavra, ...resto] = MARCA.split(' ');

  return (
    <div className="painel">
      <header className="cabecalho">
        <div className="marca">
          {primeiraPalavra} <span>{resto.join(' ')}</span>
        </div>
        <div className="usuario">
          <div>
            <div className="nome">{usuario.name}</div>
            <div className="papel">{usuario.roleLabel}</div>
          </div>
          <button className="botao botao-secundario" onClick={sair}>
            Sair
          </button>
        </div>
      </header>

      <main className="conteudo">
        <h1>Visão geral</h1>
        <p className="descricao">
          Os indicadores abaixo passam a ter dados reais quando o núcleo OCPP entrar (FASE 2).
        </p>

        <div className="grade">
          <div className="indicador">
            <div className="rotulo">Carregadores online</div>
            <div className="valor">—</div>
            <div className="nota">Disponível na FASE 2</div>
          </div>
          <div className="indicador">
            <div className="rotulo">Em uso</div>
            <div className="valor">—</div>
            <div className="nota">Disponível na FASE 2</div>
          </div>
          <div className="indicador">
            <div className="rotulo">Energia hoje</div>
            <div className="valor">—</div>
            <div className="nota">Disponível na FASE 2</div>
          </div>
          <div className="indicador">
            <div className="rotulo">Recebido hoje</div>
            <div className="valor">—</div>
            <div className="nota">Disponível na FASE 5</div>
          </div>
        </div>

        <div className="aviso-fase">
          <strong>FASE 1 concluída — fundação do projeto</strong>O que já funciona: autenticação com
          quatro perfis, verificação de saúde, banco migrado e documentação da API.
          <ul>
            <li>FASE 2 — núcleo OCPP e simulador</li>
            <li>FASE 3 — telas de carregadores e operação manual</li>
            <li>FASE 5 — pagamento simulado</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
