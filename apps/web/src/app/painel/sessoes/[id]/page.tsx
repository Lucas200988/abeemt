'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { formatCents, formatDateTime, formatDuration, formatWh } from '@bora/contracts';
import { api, ApiRequestError, loadSession } from '@/lib/api';
import { usePolling } from '@/lib/use-polling';
import { Alerta, Badge, Cartao, Carregando, Vazio, sessionTone } from '@/components/ui';

/**
 * Intervalo curto porque esta é a tela do acompanhamento ao vivo — o operador
 * fica olhando a energia subir.
 */
const INTERVALO_ATIVA_MS = 2000;
const INTERVALO_ENCERRADA_MS = 30_000;

export default function SessaoPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [mensagem, setMensagem] = useState<{
    tipo: 'erro' | 'aviso' | 'sucesso';
    texto: string;
    detalhe?: string;
  } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [intervalo, setIntervalo] = useState(INTERVALO_ATIVA_MS);

  const { dados, erro, carregando, recarregar } = usePolling(
    async () => {
      const sessao = await api.session(id);
      // Sessão encerrada não muda mais: baixamos a frequência para não bater na
      // API sem motivo.
      setIntervalo(sessao.isActive ? INTERVALO_ATIVA_MS : INTERVALO_ENCERRADA_MS);
      return sessao;
    },
    intervalo,
    `${id}:${intervalo}`,
  );

  const { dados: leituras } = usePolling(
    () => api.sessionMeterValues(id),
    intervalo,
    `${id}:${intervalo}`,
  );

  const podeOperar = loadSession()?.user.role !== 'VIEWER';

  async function parar() {
    setOcupado(true);
    setMensagem(null);
    try {
      const resultado = await api.stopSession(id);
      setMensagem({
        tipo: resultado.command.accepted ? 'sucesso' : 'aviso',
        texto: resultado.command.message,
        detalhe: resultado.command.code,
      });
      await recarregar();
    } catch (e) {
      setMensagem({
        tipo: 'erro',
        texto: e instanceof ApiRequestError ? e.message : 'Não foi possível encerrar a recarga.',
      });
    } finally {
      setOcupado(false);
    }
  }

  async function cancelar() {
    setOcupado(true);
    setMensagem(null);
    try {
      await api.cancelSession(id, 'cancelada pelo operador no painel');
      setMensagem({ tipo: 'sucesso', texto: 'Sessão cancelada.' });
      await recarregar();
    } catch (e) {
      setMensagem({
        tipo: 'erro',
        texto: e instanceof ApiRequestError ? e.message : 'Não foi possível cancelar a sessão.',
      });
    } finally {
      setOcupado(false);
    }
  }

  if (carregando && !dados) return <Carregando />;
  if (erro && !dados) return <Alerta>{erro}</Alerta>;
  if (!dados) return null;

  const podeCancelar = dados.isActive && dados.ocppTransactionId === null;
  const podeParar = dados.isActive && dados.ocppTransactionId !== null;

  return (
    <>
      <header>
        <p className="descricao">
          <Link href="/painel/sessoes">← Sessões</Link>
        </p>
        <h1>Sessão de recarga</h1>
        <p className="descricao">
          {dados.chargerName} · conector #{dados.connectorNumber} · {dados.siteName}
          {dados.isActive && ` · atualiza a cada ${intervalo / 1000}s`}
        </p>
      </header>

      {mensagem && (
        <Alerta tipo={mensagem.tipo} detalhe={mensagem.detalhe}>
          {mensagem.texto}
        </Alerta>
      )}

      {/* Vermelho só quando a sessão realmente falhou. Uma observação numa
          sessão saudável ou cancelada é aviso, não erro. */}
      {dados.failureReason && (
        <Alerta tipo={['FAILED', 'DECLINED', 'EXPIRED'].includes(dados.status) ? 'erro' : 'aviso'}>
          {dados.failureReason}
        </Alerta>
      )}

      {!dados.payment && (
        <div className="dica">
          Sessão <strong>sem pagamento vinculado</strong> — iniciada manualmente pelo painel ou no
          próprio carregador. Aparece na conciliação.
        </div>
      )}

      <div className="grade">
        <div className="indicador">
          <div className="rotulo">Situação</div>
          <div className="valor" style={{ fontSize: 19, paddingTop: 4 }}>
            <Badge tone={sessionTone(dados.status)}>{dados.statusLabel}</Badge>
          </div>
          <div className="nota">{dados.connectorStatusLabel}</div>
        </div>
        <div className="indicador">
          <div className="rotulo">Energia</div>
          <div className="valor">{dados.energyWh === null ? '—' : formatWh(dados.energyWh)}</div>
          <div className="nota">
            {dados.meterStartWh !== null
              ? `medidor iniciou em ${formatWh(dados.meterStartWh)}`
              : 'aguardando início'}
          </div>
        </div>
        <div className="indicador">
          <div className="rotulo">Duração</div>
          <div className="valor">{formatDuration(dados.durationSeconds)}</div>
          <div className="nota">{dados.isActive ? 'em andamento' : 'encerrada'}</div>
        </div>
        <div className="indicador">
          <div className="rotulo">Teto da sessão</div>
          <div className="valor">
            {dados.ceilingAmountCents === null ? '—' : formatCents(dados.ceilingAmountCents)}
          </div>
          <div className="nota">valor máximo a cobrar</div>
        </div>
        <div className="indicador">
          <div className="rotulo">Valor final</div>
          <div className="valor">
            {dados.finalAmountCents === null ? '—' : formatCents(dados.finalAmountCents)}
          </div>
          {/* Honesto sobre o que ainda não existe. */}
          <div className="nota">cálculo chega na FASE 6</div>
        </div>
      </div>

      {podeOperar && (podeParar || podeCancelar) && (
        <Cartao titulo="Operação">
          <div className="acoes">
            {podeParar && (
              <button className="btn btn-perigo" onClick={() => void parar()} disabled={ocupado}>
                Parar recarga
              </button>
            )}
            {podeCancelar && (
              <button className="btn btn-sec" onClick={() => void cancelar()} disabled={ocupado}>
                Cancelar sessão
              </button>
            )}
          </div>
          <p style={{ fontSize: 12, color: 'var(--texto-suave)', marginTop: 10 }}>
            {podeParar
              ? 'A recarga já começou: parar envia o comando ao carregador e aguarda a leitura final do medidor.'
              : 'A recarga ainda não começou, então pode ser cancelada sem envolver o equipamento.'}
          </p>
        </Cartao>
      )}

      <Cartao titulo="Linha do tempo">
        <div className="timeline">
          {dados.timeline.map((passo, i) => (
            <div key={passo.key} className={`tl-passo${passo.done ? ' feito' : ''}`}>
              <div className="tl-marca">
                <div className="tl-ponto" />
                {i < dados.timeline.length - 1 && <div className="tl-linha" />}
              </div>
              <div className="tl-corpo">
                <div className="tl-titulo">{passo.label}</div>
                <div className="tl-quando">
                  {passo.at ? formatDateTime(passo.at) : passo.done ? 'concluído' : 'pendente'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Cartao>

      <Cartao titulo="Leituras do medidor">
        {!leituras || leituras.length === 0 ? (
          <Vazio>Nenhuma leitura recebida ainda.</Vazio>
        ) : (
          <>
            <GraficoEnergia leituras={leituras} />
            <div className="tabela-scroll" style={{ maxHeight: 240, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Momento</th>
                    <th className="numero">Energia acumulada</th>
                  </tr>
                </thead>
                <tbody>
                  {[...leituras].reverse().map((l, i) => (
                    <tr key={`${l.timestamp}-${i}`}>
                      <td>{formatDateTime(l.timestamp)}</td>
                      <td className="numero">{formatWh(l.energyWh)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Cartao>

      <Cartao titulo="Diagnóstico técnico">
        <div className="defs">
          <div className="def">
            <div className="rotulo">Identificador da sessão</div>
            <div className="valor mono">{dados.id}</div>
          </div>
          <div className="def">
            <div className="rotulo">transactionId (OCPP)</div>
            <div className="valor mono">{dados.ocppTransactionId ?? '—'}</div>
          </div>
          <div className="def">
            <div className="rotulo">idTag</div>
            <div className="valor mono">{dados.idTag ?? '—'}</div>
          </div>
          <div className="def">
            <div className="rotulo">Charge Point Identity</div>
            <div className="valor mono">{dados.chargePointIdentity}</div>
          </div>
          <div className="def">
            <div className="rotulo">Medidor inicial</div>
            <div className="valor">
              {dados.meterStartWh === null ? '—' : `${dados.meterStartWh} Wh`}
            </div>
          </div>
          <div className="def">
            <div className="rotulo">Medidor final</div>
            <div className="valor">
              {dados.meterStopWh === null ? '—' : `${dados.meterStopWh} Wh`}
            </div>
          </div>
          <div className="def">
            <div className="rotulo">Motivo do encerramento</div>
            <div className="valor">
              {dados.stopReasonLabel ?? '—'}
              {dados.stopReason && (
                <span style={{ color: 'var(--texto-suave)', fontSize: 11 }}>
                  {' '}
                  ({dados.stopReason})
                </span>
              )}
            </div>
          </div>
          <div className="def">
            <div className="rotulo">Pagamento</div>
            <div className="valor">
              {dados.payment
                ? `${dados.payment.methodLabel} · ${dados.payment.statusLabel}`
                : 'sem pagamento vinculado'}
            </div>
          </div>
        </div>

        <div className="acoes" style={{ marginTop: 16 }}>
          <Link
            className="btn btn-sec btn-mini"
            href={`/painel/diagnostico?charger=${dados.chargerId}`}
          >
            Mensagens OCPP deste carregador
          </Link>
        </div>
      </Cartao>
    </>
  );
}

/**
 * Gráfico simples da energia acumulada, em SVG puro.
 *
 * Uma biblioteca de gráficos para uma linha só seria peso desnecessário no MVP
 * (regra 18.7). Se o painel ganhar mais gráficos, aí sim vale a dependência.
 */
function GraficoEnergia({ leituras }: { leituras: { timestamp: string; energyWh: number }[] }) {
  if (leituras.length < 2) return null;

  const largura = 100;
  const altura = 30;
  const maximo = Math.max(...leituras.map((l) => l.energyWh), 1);

  const pontos = leituras
    .map((l, i) => {
      const x = (i / (leituras.length - 1)) * largura;
      const y = altura - (l.energyWh / maximo) * altura;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <div style={{ marginBottom: 16 }}>
      <svg
        viewBox={`0 0 ${largura} ${altura}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: 90, display: 'block' }}
        role="img"
        aria-label={`Energia acumulada, de 0 a ${formatWh(maximo)}`}
      >
        <polyline
          points={pontos}
          fill="none"
          stroke="var(--verde)"
          strokeWidth={0.7}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: 'var(--texto-suave)',
        }}
      >
        <span>0</span>
        <span>{formatWh(maximo)}</span>
      </div>
    </div>
  );
}
