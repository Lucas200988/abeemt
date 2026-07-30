'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatCents, formatDateTime } from '@bora/contracts';
import {
  api,
  ApiRequestError,
  loadSession,
  type ChargerView,
  type ProviderInfo,
} from '@/lib/api';
import { usePolling } from '@/lib/use-polling';
import { Alerta, Badge, Cartao, Carregando, Vazio, type Tone } from '@/components/ui';

/**
 * Pagamentos e simulação de cobrança (FASE 5).
 *
 * A tela existe por dois motivos:
 *
 *  1. Conferir o que foi reservado, cobrado e devolvido — é a conciliação do
 *     estabelecimento.
 *  2. Disparar uma recarga paga sem maquininha, para provar o fluxo financeiro
 *     ponta a ponta antes de existir adquirente real.
 *
 * O aviso de "pagamento simulado" é permanente e não pode ser fechado: uma tela
 * que cobra de mentira precisa dizer isso o tempo todo.
 */

const INTERVALO_MS = 5000;

function pagamentoTone(status: string): Tone {
  switch (status) {
    case 'CAPTURED':
      return 'ok';
    case 'AUTHORIZED':
      return 'info';
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
    case 'VOIDED':
      return 'neutral';
    case 'DECLINED':
    case 'FAILED':
    case 'EXPIRED':
      return 'bad';
    default:
      return 'warn';
  }
}

export default function PagamentosPage() {
  const [mensagem, setMensagem] = useState<{
    tipo: 'erro' | 'aviso' | 'sucesso';
    texto: string;
    detalhe?: string;
  } | null>(null);

  const [provedores, setProvedores] = useState<ProviderInfo | null>(null);
  const [carregadores, setCarregadores] = useState<ChargerView[]>([]);

  const { dados, erro, carregando, recarregar } = usePolling(
    () => api.payments(),
    INTERVALO_MS,
    'pagamentos',
  );

  useEffect(() => {
    api.paymentProviders().then(setProvedores).catch(() => undefined);
    api
      .chargers()
      .then((r) => setCarregadores(r.items))
      .catch(() => undefined);
  }, []);

  const papel = loadSession()?.user.role;
  const podeOperar = papel === 'OPERATOR' || papel === 'ORG_ADMIN' || papel === 'SUPER_ADMIN';
  const podeDevolver = papel === 'ORG_ADMIN' || papel === 'SUPER_ADMIN';

  const simulado = provedores?.available.find((p) => p.name === provedores.default)?.simulated;

  async function devolver(id: string) {
    const motivo = window.prompt('Motivo da devolução (fica registrado na auditoria):');
    if (!motivo) return;

    try {
      const r = await api.refundPayment(id, motivo);
      setMensagem({ tipo: 'sucesso', texto: `Pagamento agora está em ${r.status}.` });
      await recarregar();
    } catch (e) {
      setMensagem({
        tipo: 'erro',
        texto: e instanceof ApiRequestError ? e.message : 'Não foi possível devolver o valor.',
      });
    }
  }

  return (
    <>
      <header>
        <h1>Pagamentos</h1>
        <p className="descricao">
          Pré-autorização e captura pelo consumo real. Atualiza a cada {INTERVALO_MS / 1000}s.
        </p>
      </header>

      {simulado && (
        <Alerta tipo="aviso">
          O provedor de pagamento em uso é <strong>{provedores?.default}</strong>, que é{' '}
          <strong>simulado</strong>. Nenhum valor real é reservado, cobrado ou devolvido. Trocar
          para um adquirente real é configuração de ambiente (<code>BORA_PAYMENT_PROVIDER</code>).
        </Alerta>
      )}

      {mensagem && <Alerta tipo={mensagem.tipo}>{mensagem.texto}</Alerta>}

      {podeOperar && (
        <SimularCobranca
          carregadores={carregadores}
          onResultado={(m) => {
            setMensagem(m);
            void recarregar();
          }}
        />
      )}

      <Cartao titulo="Pagamentos registrados">
        {carregando && !dados ? (
          <Carregando />
        ) : erro && !dados ? (
          <Alerta>{erro}</Alerta>
        ) : !dados || dados.items.length === 0 ? (
          <Vazio>Nenhum pagamento ainda.</Vazio>
        ) : (
          <div className="tabela-scroll">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Meio</th>
                  <th>Situação</th>
                  <th className="numero">Reservado</th>
                  <th className="numero">Cobrado</th>
                  <th className="numero">Devolvido</th>
                  <th>Recarga</th>
                  {podeDevolver && <th />}
                </tr>
              </thead>
              <tbody>
                {dados.items.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDateTime(p.createdAt)}</td>
                    <td>
                      {p.methodLabel}
                      {p.cardLastFour && (
                        <span style={{ color: 'var(--texto-suave)' }}> ····{p.cardLastFour}</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={pagamentoTone(p.status)}>{p.statusLabel}</Badge>
                    </td>
                    <td className="numero">{formatCents(p.amountAuthorizedCents)}</td>
                    <td className="numero">{formatCents(p.amountCapturedCents)}</td>
                    <td className="numero">
                      {p.amountRefundedCents > 0 ? formatCents(p.amountRefundedCents) : '—'}
                    </td>
                    <td>
                      {p.session ? (
                        <Link href={`/painel/sessoes/${p.session.id}`}>ver recarga</Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    {podeDevolver && (
                      <td>
                        {/* Só faz sentido devolver o que ainda tem o que devolver. */}
                        {['AUTHORIZED', 'CAPTURED', 'PARTIALLY_REFUNDED'].includes(p.status) && (
                          <button
                            className="btn btn-sec btn-mini"
                            onClick={() => void devolver(p.id)}
                          >
                            {p.status === 'AUTHORIZED' ? 'Cancelar reserva' : 'Devolver'}
                          </button>
                        )}
                      </td>
                    )}
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

/**
 * Dispara uma recarga paga.
 *
 * É o que a maquininha fará na FASE 8. Aqui serve para provar o caminho
 * completo — reserva, consumo, parada no teto e captura — sem hardware.
 */
function SimularCobranca({
  carregadores,
  onResultado,
}: {
  carregadores: ChargerView[];
  onResultado: (m: { tipo: 'erro' | 'aviso' | 'sucesso'; texto: string }) => void;
}) {
  const [connectorId, setConnectorId] = useState('');
  const [metodo, setMetodo] = useState('CREDIT_CARD');
  const [valor, setValor] = useState('200,00');
  const [ocupado, setOcupado] = useState(false);

  const disponiveis = carregadores.flatMap((c) =>
    c.connectors.map((con) => ({
      id: con.id,
      rotulo: `${c.name} · conector #${con.connectorNumber} (${con.statusLabel})`,
      pronto: con.status === 'PREPARING' || con.status === 'AVAILABLE',
      online: c.liveConnected,
    })),
  );

  async function cobrar() {
    if (!connectorId) return;

    // Reais para centavos, sem passar por float: "200,00" vira 20000 por
    // manipulação de texto, e não por multiplicação (ADR-0005).
    const limpo = valor.replace(/\s/g, '').replace('.', '').replace(',', '.');
    const centavos = Math.round(Number(limpo) * 100);

    if (!Number.isFinite(centavos) || centavos <= 0) {
      onResultado({ tipo: 'erro', texto: 'Informe um valor válido, como 200,00.' });
      return;
    }

    setOcupado(true);
    try {
      const r = await api.startPaidSession({ connectorId, method: metodo, amountCents: centavos });

      onResultado({
        tipo: r.command?.accepted ? 'sucesso' : 'aviso',
        texto: r.message,
      });
    } catch (e) {
      onResultado({
        tipo: 'erro',
        texto: e instanceof ApiRequestError ? e.message : 'Não foi possível iniciar a cobrança.',
      });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Cartao titulo="Simular cobrança e iniciar recarga">
      <div className="form-grade">
        <div className="campo">
          <label htmlFor="connectorId">Conector</label>
          <select
            id="connectorId"
            value={connectorId}
            onChange={(e) => setConnectorId(e.target.value)}
          >
            <option value="">Selecione…</option>
            {disponiveis.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.online}>
                {c.rotulo}
                {!c.online && ' — carregador desconectado'}
              </option>
            ))}
          </select>
          <p className="ajuda">
            Carregadores desconectados aparecem desabilitados: o comando não teria como chegar.
          </p>
        </div>

        <div className="campo">
          <label htmlFor="metodo">Meio de pagamento</label>
          <select id="metodo" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
            <option value="CREDIT_CARD">Cartão de crédito (reserva e cobra o consumido)</option>
            <option value="DEBIT_CARD">Cartão de débito</option>
            <option value="PIX">Pix (valor fixo, cobrado na hora)</option>
          </select>
        </div>

        <div className="campo">
          <label htmlFor="valor">
            {metodo === 'PIX' ? 'Valor a pagar (R$)' : 'Valor a reservar (R$)'}
          </label>
          <input
            id="valor"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            inputMode="decimal"
          />
        </div>
      </div>

      <div className="acoes" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => void cobrar()} disabled={ocupado || !connectorId}>
          {ocupado ? 'Processando…' : 'Cobrar e iniciar recarga'}
        </button>
      </div>

      <p style={{ fontSize: 12, color: 'var(--texto-suave)', marginTop: 10 }}>
        {metodo === 'PIX'
          ? 'No Pix o valor é cobrado integralmente no início. Se nenhuma energia for entregue, ele é devolvido por inteiro.'
          : 'No cartão o valor é apenas reservado. No fim da recarga, cobramos somente o que foi consumido e a diferença é liberada pelo emissor.'}
      </p>
    </Cartao>
  );
}
