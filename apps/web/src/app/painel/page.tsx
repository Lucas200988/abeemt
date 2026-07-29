'use client';

import Link from 'next/link';
import { formatCents, formatDateTime, formatRelative, formatWh } from '@bora/contracts';
import { api } from '@/lib/api';
import { usePolling } from '@/lib/use-polling';
import { Alerta, Badge, Cartao, Carregando, Vazio, sessionTone } from '@/components/ui';

/** Intervalo curto: esta é a tela que fica aberta durante uma operação. */
const INTERVALO_MS = 5000;

export default function VisaoGeralPage() {
  const { dados, erro, carregando } = usePolling(() => api.overview(), INTERVALO_MS);

  if (carregando && !dados) return <Carregando />;

  return (
    <>
      <header>
        <h1>Visão geral</h1>
        <p className="descricao">
          Atualiza a cada {INTERVALO_MS / 1000} segundos
          {dados && ` · "hoje" começa em ${formatDateTime(dados.dayStartedAt)}`}
        </p>
      </header>

      {erro && <Alerta>{erro}</Alerta>}

      {dados && (
        <>
          <div className="grade">
            <div className="indicador">
              <div className="rotulo">Carregadores online</div>
              <div className="valor">{dados.chargers.online}</div>
              <div className="nota">de {dados.chargers.total} cadastrados</div>
            </div>
            <div className="indicador">
              <div className="rotulo">Offline</div>
              <div className="valor">{dados.chargers.offline}</div>
              <div className="nota">
                {dados.chargers.blocked > 0
                  ? `${dados.chargers.blocked} bloqueado(s)`
                  : 'nenhum bloqueado'}
              </div>
            </div>
            <div className="indicador">
              <div className="rotulo">Em uso</div>
              <div className="valor">{dados.chargers.charging}</div>
              <div className="nota">
                {dados.chargers.faulted > 0
                  ? `${dados.chargers.faulted} conector(es) em falha`
                  : 'nenhuma falha'}
              </div>
            </div>
            <div className="indicador">
              <div className="rotulo">Energia hoje</div>
              <div className="valor">{formatWh(dados.today.energyWh)}</div>
              <div className="nota">{dados.today.sessionsCompleted} sessão(ões) concluída(s)</div>
            </div>
            <div className="indicador">
              <div className="rotulo">Recebido hoje</div>
              <div className="valor">{formatCents(dados.today.receivedCents)}</div>
              {/* Honesto: sem cálculo financeiro, este número é zero por construção. */}
              <div className="nota">valor final chega na FASE 6</div>
            </div>
            <div className="indicador">
              <div className="rotulo">Conexões OCPP</div>
              <div className="valor">{dados.ocpp.connectedNow}</div>
              <div className="nota">
                {dados.ocpp.pendingCommands} comando(s) aguardando resposta
              </div>
            </div>
          </div>

          <Cartao titulo={`Sessões em andamento (${dados.activeSessions.length})`}>
            {dados.activeSessions.length === 0 ? (
              <Vazio>Nenhuma recarga em andamento.</Vazio>
            ) : (
              <div className="tabela-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Carregador</th>
                      <th>Conector</th>
                      <th>Situação</th>
                      <th>Início</th>
                      <th className="numero">Energia</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {dados.activeSessions.map((s) => (
                      <tr key={s.id}>
                        <td>{s.chargerName}</td>
                        <td>#{s.connectorNumber}</td>
                        <td>
                          <Badge tone={sessionTone(s.status)}>{s.statusLabel}</Badge>
                        </td>
                        <td>{formatRelative(s.startedAt)}</td>
                        <td className="numero">
                          {s.energyWh === null ? '—' : formatWh(s.energyWh)}
                        </td>
                        <td>
                          <Link href={`/painel/sessoes/${s.id}`}>Acompanhar</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Cartao>

          <Cartao titulo="Sessões recentes" acao={<Link href="/painel/sessoes">Ver todas</Link>}>
            {dados.recentSessions.length === 0 ? (
              <Vazio>Nenhuma sessão registrada ainda.</Vazio>
            ) : (
              <div className="tabela-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Carregador</th>
                      <th>Situação</th>
                      <th>Quando</th>
                      <th className="numero">Energia</th>
                      <th className="numero">Valor</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {dados.recentSessions.map((s) => (
                      <tr key={s.id}>
                        <td>{s.chargerName}</td>
                        <td>
                          <Badge tone={sessionTone(s.status)}>{s.statusLabel}</Badge>
                        </td>
                        <td>{formatRelative(s.requestedAt)}</td>
                        <td className="numero">
                          {s.energyWh === null ? '—' : formatWh(s.energyWh)}
                        </td>
                        <td className="numero">
                          {s.finalAmountCents === null ? '—' : formatCents(s.finalAmountCents)}
                        </td>
                        <td>
                          <Link href={`/painel/sessoes/${s.id}`}>Detalhe</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Cartao>

          {dados.recentFailures.length > 0 && (
            <Cartao titulo="Falhas recentes">
              <div className="tabela-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Carregador</th>
                      <th>Situação</th>
                      <th>Motivo</th>
                      <th>Quando</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {dados.recentFailures.map((s) => (
                      <tr key={s.id}>
                        <td>{s.chargerName}</td>
                        <td>
                          <Badge tone="bad">{s.statusLabel}</Badge>
                        </td>
                        <td>{s.failureReason ?? '—'}</td>
                        <td>{formatRelative(s.requestedAt)}</td>
                        <td>
                          <Link href={`/painel/sessoes/${s.id}`}>Detalhe</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Cartao>
          )}
        </>
      )}
    </>
  );
}
