'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatDateTime } from '@bora/contracts';
import { api } from '@/lib/api';
import { usePolling } from '@/lib/use-polling';
import { Alerta, Badge, Cartao, Carregando, Vazio } from '@/components/ui';

/**
 * Área de diagnóstico.
 *
 * Aqui o termo técnico é bem-vindo: quem abre esta tela quer exatamente o
 * payload cru. A seção 14 do briefing manda esconder jargão OCPP do operador —
 * e reservar um lugar onde ele fique disponível. Este é o lugar.
 */
export default function DiagnosticoPage() {
  return (
    <Suspense fallback={<Carregando />}>
      <Diagnostico />
    </Suspense>
  );
}

const ACOES = [
  'BootNotification',
  'Heartbeat',
  'StatusNotification',
  'Authorize',
  'StartTransaction',
  'StopTransaction',
  'MeterValues',
  'RemoteStartTransaction',
  'RemoteStopTransaction',
];

function Diagnostico() {
  const searchParams = useSearchParams();
  const [chargerId, setChargerId] = useState(searchParams.get('charger') ?? '');
  const [acao, setAcao] = useState('');
  const [direcao, setDirecao] = useState('');
  const [somenteErros, setSomenteErros] = useState(false);
  const [pausado, setPausado] = useState(false);

  const { dados: carregadores } = usePolling(() => api.chargers(), 60_000);

  // Sem carregador escolhido não há o que buscar; com pausa, congelamos para
  // que o operador consiga ler uma mensagem sem ela sumir da tela.
  const { dados, erro, carregando } = usePolling(
    async () => {
      if (!chargerId || pausado) return null;
      return api.chargerMessages(chargerId, {
        action: acao || undefined,
        direction: direcao || undefined,
        onlyErrors: somenteErros || undefined,
      });
    },
    3000,
    `${chargerId}|${acao}|${direcao}|${somenteErros}|${pausado}`,
  );

  const escolhido = carregadores?.items.find((c) => c.id === chargerId);

  return (
    <>
      <header>
        <h1>Diagnóstico OCPP</h1>
        <p className="descricao">
          Mensagens trocadas com o equipamento, sem tradução. Para investigação técnica.
        </p>
      </header>

      {erro && <Alerta>{erro}</Alerta>}

      <div className="filtros">
        <div className="campo">
          <label htmlFor="charger">Carregador</label>
          <select id="charger" value={chargerId} onChange={(e) => setChargerId(e.target.value)}>
            <option value="">Escolha um carregador</option>
            {carregadores?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.chargePointIdentity})
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="acao">Ação</label>
          <select id="acao" value={acao} onChange={(e) => setAcao(e.target.value)}>
            <option value="">Todas</option>
            {ACOES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="direcao">Direção</label>
          <select id="direcao" value={direcao} onChange={(e) => setDirecao(e.target.value)}>
            <option value="">Ambas</option>
            <option value="INBOUND">Do carregador</option>
            <option value="OUTBOUND">Para o carregador</option>
          </select>
        </div>

        <div className="campo">
          <label htmlFor="erros" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              id="erros"
              type="checkbox"
              checked={somenteErros}
              onChange={(e) => setSomenteErros(e.target.checked)}
              style={{ width: 'auto' }}
            />
            Somente com erro
          </label>
        </div>

        <button className="btn btn-sec" onClick={() => setPausado((v) => !v)}>
          {pausado ? 'Retomar' : 'Pausar'}
        </button>
      </div>

      {escolhido && (
        <div className="dica">
          <code>{escolhido.ocppUrl}</code> ·{' '}
          {escolhido.liveConnected ? 'conectado agora' : 'desconectado'} ·{' '}
          {escolhido.hasCredentials ? 'com credencial' : 'sem credencial'}
        </div>
      )}

      {!chargerId ? (
        <Cartao>
          <Vazio>Escolha um carregador para ver as mensagens.</Vazio>
        </Cartao>
      ) : carregando && !dados ? (
        <Carregando />
      ) : !dados || dados.items.length === 0 ? (
        <Cartao>
          <Vazio>
            Nenhuma mensagem com esses filtros. Se o carregador nunca conectou, não há mensagens.
          </Vazio>
        </Cartao>
      ) : (
        <Cartao titulo={`${dados.total} mensagem(ns)${pausado ? ' — atualização pausada' : ''}`}>
          <div className="tabela-scroll">
            <table>
              <thead>
                <tr>
                  <th>Momento</th>
                  <th>Direção</th>
                  <th>Ação</th>
                  <th>Conteúdo</th>
                  <th className="numero">Resposta</th>
                </tr>
              </thead>
              <tbody>
                {dados.items.map((m) => (
                  <tr key={m.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                      {formatDateTime(m.receivedAt)}
                    </td>
                    <td>
                      <span className={m.direction === 'INBOUND' ? 'dir-in' : 'dir-out'}>
                        {m.direction === 'INBOUND' ? '← recebida' : '→ enviada'}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {m.action ?? <em style={{ color: 'var(--texto-suave)' }}>malformada</em>}
                      {m.errorCode && (
                        <div style={{ marginTop: 4 }}>
                          <Badge tone="bad">{m.errorCode}</Badge>
                        </div>
                      )}
                    </td>
                    <td style={{ minWidth: 260, maxWidth: 420 }}>
                      <pre className="msg-payload">{JSON.stringify(m.payload, null, 2)}</pre>
                      {m.responsePayload !== null && m.responsePayload !== undefined && (
                        <pre className="msg-payload" style={{ marginTop: 6 }}>
                          resposta: {JSON.stringify(m.responsePayload, null, 2)}
                        </pre>
                      )}
                      {m.errorDescription && (
                        <p style={{ fontSize: 11, color: 'var(--erro)', marginTop: 6 }}>
                          {m.errorDescription}
                        </p>
                      )}
                    </td>
                    <td className="numero" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                      {m.processingDurationMs === null ? '—' : `${m.processingDurationMs} ms`}
                      {m.correlationId && (
                        <div
                          style={{
                            fontSize: 10,
                            color: 'var(--texto-suave)',
                            fontFamily: 'ui-monospace, monospace',
                          }}
                          title={m.correlationId}
                        >
                          {m.correlationId.slice(0, 8)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Cartao>
      )}
    </>
  );
}
