'use client';

import type { ReactNode } from 'react';

/**
 * Indicador de estado.
 *
 * A cor comunica junto com o texto, nunca sozinha: quem não distingue verde de
 * vermelho precisa conseguir operar o painel igual.
 */
export type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'info';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** Traduz o estado do conector para um tom visual. */
export function connectorTone(status: string): Tone {
  switch (status) {
    case 'CHARGING':
      return 'ok';
    case 'PREPARING':
    case 'FINISHING':
      return 'info';
    case 'SUSPENDED_EV':
    case 'SUSPENDED_EVSE':
      return 'warn';
    case 'FAULTED':
      return 'bad';
    case 'UNAVAILABLE':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function sessionTone(status: string): Tone {
  switch (status) {
    case 'CHARGING':
      return 'ok';
    case 'COMPLETED':
      return 'info';
    case 'FAILED':
    case 'DECLINED':
    case 'EXPIRED':
      return 'bad';
    case 'CANCELLED':
      return 'neutral';
    default:
      return 'warn';
  }
}

export function Alerta({
  tipo = 'erro',
  children,
  detalhe,
}: {
  tipo?: 'erro' | 'aviso' | 'sucesso';
  children: ReactNode;
  detalhe?: string;
}) {
  return (
    <div className={`alerta alerta-${tipo}`} role="alert">
      {children}
      {detalhe && <code className="detalhe-tecnico">{detalhe}</code>}
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <p className="vazio">{children}</p>;
}

export function Carregando() {
  return <p className="vazio">Carregando…</p>;
}

export function Cartao({
  titulo,
  acao,
  children,
}: {
  titulo?: string;
  acao?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bloco">
      {(titulo || acao) && (
        <header className="bloco-cabecalho">
          {titulo && <h2>{titulo}</h2>}
          {acao}
        </header>
      )}
      {children}
    </section>
  );
}
