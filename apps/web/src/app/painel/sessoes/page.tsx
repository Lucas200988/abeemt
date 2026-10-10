'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatCents, formatDuration, formatRelative, formatWh } from '@bora/contracts';
import { api } from '@/lib/api';
import { usePolling } from '@/lib/use-polling';
import { Alerta, Badge, Cartao, Carregando, Vazio, sessionTone } from '@/components/ui';

export default function SessoesPage() {
  const [somenteAtivas, setSomenteAtivas] = useState(false);

  const { dados, erro, carregando } = usePolling(
    () => api.sessions({ activeOnly: somenteAtivas || undefined }),
    5000,
    String(somenteAtivas),
  );

  if (carregando && !dados) return <Carregando />;

  return (
    <>
      <header>
        <h1>Sessões</h1>
        <p className="descricao">
          {dados ? `${dados.total} sessão(ões)` : ''} · atualiza a cada 5 segundos
        </p>
      </header>

      {erro && <Alerta>{erro}</Alerta>}

      <div className="filtros">
        <div className="campo">
          <label htmlFor="ativas" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              id="ativas"
              type="checkbox"
              checked={somenteAtivas}
              onChange={(e) => setSomenteAtivas(e.target.checked)}
              style={{ width: 'auto' }}
            />
            Apenas em andamento
          </label>
        </div>
      </div>

      <Cartao>
        {!dados || dados.items.length === 0 ? (
          <Vazio>
            {somenteAtivas
              ? 'Nenhuma recarga em andamento.'
              : 'Nenhuma sessão registrada. Inicie uma pela tela do carregador.'}
          </Vazio>
        ) : (
          <div className="tabela-scroll">
            <table>
              <thead>
                <tr>
                  <th>Carregador</th>
                  <th>Conector</th>
                  <th>Situação</th>
                  <th>Solicitada</th>
                  <th className="numero">Duração</th>
                  <th className="numero">Energia</th>
                  <th className="numero">Valor</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {dados.items.map((s) => (
                  <tr key={s.id}>
                    <td>{s.chargerName}</td>
                    <td>#{s.connectorNumber}</td>
                    <td>
                      <Badge tone={sessionTone(s.status)}>{s.statusLabel}</Badge>
                    </td>
                    <td>{formatRelative(s.requestedAt)}</td>
                    <td className="numero">{formatDuration(s.durationSeconds)}</td>
                    <td className="numero">{s.energyWh === null ? '—' : formatWh(s.energyWh)}</td>
                    <td className="numero">
                      {s.finalAmountCents === null ? '—' : formatCents(s.finalAmountCents)}
                    </td>
                    <td>
                      <Link href={`/painel/sessoes/${s.id}`}>
                        {s.isActive ? 'Acompanhar' : 'Detalhe'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </>
  );
}
