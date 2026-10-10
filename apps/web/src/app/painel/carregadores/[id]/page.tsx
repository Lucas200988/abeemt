'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { formatCents, formatDateTime, formatKw, formatRelative } from '@bora/contracts';
import { api, ApiRequestError, loadSession } from '@/lib/api';
import { usePolling } from '@/lib/use-polling';
import { Alerta, Badge, Cartao, Carregando, Vazio, connectorTone } from '@/components/ui';

const INTERVALO_MS = 3000;

export default function CarregadorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [mensagem, setMensagem] = useState<{
    tipo: 'erro' | 'aviso' | 'sucesso';
    texto: string;
    detalhe?: string;
  } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [credencial, setCredencial] = useState<{ valor: string; url: string } | null>(null);

  const { dados, erro, carregando, recarregar } = usePolling(
    () => api.charger(id),
    INTERVALO_MS,
    id,
  );

  const papel = loadSession()?.user.role;
  const podeOperar = papel !== 'VIEWER';
  const podeAdministrar = papel === 'ORG_ADMIN' || papel === 'SUPER_ADMIN';

  async function comAcao(acao: () => Promise<void>) {
    setOcupado(true);
    setMensagem(null);
    try {
      await acao();
      await recarregar();
    } catch (e) {
      setMensagem({
        tipo: 'erro',
        texto: e instanceof ApiRequestError ? e.message : 'A operação não pôde ser concluída.',
        detalhe: e instanceof ApiRequestError ? e.requestId : undefined,
      });
    } finally {
      setOcupado(false);
    }
  }

  async function iniciar(connectorId: string) {
    await comAcao(async () => {
      const resultado = await api.startManual(connectorId);

      // O comando pode ser recusado sem que a requisição falhe: são coisas
      // diferentes, e a mensagem do carregador é o que interessa ao operador.
      setMensagem({
        tipo: resultado.command.accepted ? 'sucesso' : 'aviso',
        texto: resultado.command.message,
        detalhe: resultado.command.code,
      });

      if (resultado.command.accepted) {
        router.push(`/painel/sessoes/${resultado.session.id}`);
      }
    });
  }

  async function parar(sessionId: string) {
    await comAcao(async () => {
      const resultado = await api.stopSession(sessionId);
      setMensagem({
        tipo: resultado.command.accepted ? 'sucesso' : 'aviso',
        texto: resultado.command.message,
        detalhe: resultado.command.code,
      });
    });
  }

  async function alternarBloqueio() {
    if (!dados) return;
    const novo = dados.operationalStatus === 'BLOCKED' ? 'AVAILABLE' : 'BLOCKED';

    await comAcao(async () => {
      await api.setChargerStatus(id, novo, 'alterado pelo painel');
      setMensagem({
        tipo: 'sucesso',
        texto:
          novo === 'BLOCKED'
            ? 'Carregador bloqueado. Recargas em andamento continuam; apenas novas ficam impedidas.'
            : 'Carregador liberado.',
      });
    });
  }

  async function rotacionarCredencial() {
    await comAcao(async () => {
      const resultado = await api.rotateCredential(id);
      setCredencial({ valor: resultado.credential, url: resultado.ocppUrl });
    });
  }

  if (carregando && !dados) return <Carregando />;
  if (erro && !dados) return <Alerta>{erro}</Alerta>;
  if (!dados) return null;

  return (
    <>
      <header>
        <p className="descricao">
          <Link href="/painel/carregadores">← Carregadores</Link>
        </p>
        <h1>{dados.name}</h1>
        <p className="descricao">
          {dados.siteName} · atualiza a cada {INTERVALO_MS / 1000} segundos
        </p>
      </header>

      {mensagem && (
        <Alerta tipo={mensagem.tipo} detalhe={mensagem.detalhe}>
          {mensagem.texto}
        </Alerta>
      )}

      {credencial && (
        <Alerta tipo="aviso">
          <strong>Credencial nova. A anterior deixou de valer.</strong>
          <code className="detalhe-tecnico">
            URL: {credencial.url}
            {'\n'}Usuário: {dados.chargePointIdentity}
            {'\n'}Senha: {credencial.valor}
          </code>
        </Alerta>
      )}

      <Cartao titulo="Situação">
        <div className="acoes" style={{ marginBottom: 16 }}>
          <Badge tone={dados.liveConnected ? 'ok' : 'bad'}>
            {dados.liveConnected ? 'Online' : dados.connectionStatusLabel}
          </Badge>
          <Badge tone={dados.operationalStatus === 'AVAILABLE' ? 'ok' : 'warn'}>
            {dados.operationalStatusLabel}
          </Badge>
          {!dados.hasCredentials && <Badge tone="warn">Sem credencial</Badge>}
        </div>

        <div className="defs">
          <div className="def">
            <div className="rotulo">Charge Point Identity</div>
            <div className="valor mono">{dados.chargePointIdentity}</div>
          </div>
          <div className="def">
            <div className="rotulo">Fabricante e modelo</div>
            <div className="valor">
              {dados.manufacturer || dados.model
                ? `${dados.manufacturer ?? ''} ${dados.model ?? ''}`.trim()
                : 'informado pelo equipamento ao conectar'}
            </div>
          </div>
          <div className="def">
            <div className="rotulo">Firmware</div>
            <div className="valor">{dados.firmwareVersion ?? '—'}</div>
          </div>
          <div className="def">
            <div className="rotulo">Número de série</div>
            <div className="valor">{dados.serialNumber ?? '—'}</div>
          </div>
          <div className="def">
            <div className="rotulo">Protocolo</div>
            <div className="valor">{dados.protocolVersion}</div>
          </div>
          <div className="def">
            <div className="rotulo">Última comunicação</div>
            <div className="valor">
              {formatRelative(dados.lastSeenAt)}
              {dados.lastSeenAt && (
                <span style={{ color: 'var(--texto-suave)', fontSize: 11 }}>
                  {' '}
                  ({formatDateTime(dados.lastSeenAt)})
                </span>
              )}
            </div>
          </div>
          <div className="def">
            <div className="rotulo">Último reinício</div>
            <div className="valor">{formatRelative(dados.lastBootAt)}</div>
          </div>
          <div className="def">
            <div className="rotulo">Último heartbeat</div>
            <div className="valor">{formatRelative(dados.lastHeartbeatAt)}</div>
          </div>
          <div className="def">
            <div className="rotulo">Teto por sessão</div>
            <div className="valor">
              {formatCents(dados.effectivePreAuthCeilingCents)}
              <span style={{ color: 'var(--texto-suave)', fontSize: 11 }}>
                {' '}
                ({dados.preAuthCeilingSource})
              </span>
            </div>
          </div>
        </div>

        {podeOperar && (
          <div className="acoes" style={{ marginTop: 18 }}>
            <button
              className={dados.operationalStatus === 'BLOCKED' ? 'btn btn-ok' : 'btn btn-sec'}
              onClick={() => void alternarBloqueio()}
              disabled={ocupado}
            >
              {dados.operationalStatus === 'BLOCKED' ? 'Liberar carregador' : 'Bloquear carregador'}
            </button>
            {podeAdministrar && (
              <button
                className="btn btn-sec"
                onClick={() => void rotacionarCredencial()}
                disabled={ocupado}
              >
                Gerar credencial nova
              </button>
            )}
            <Link className="btn btn-sec" href={`/painel/diagnostico?charger=${dados.id}`}>
              Ver mensagens OCPP
            </Link>
          </div>
        )}
      </Cartao>

      <div className="dica">
        Configure esta URL no equipamento: <code>{dados.ocppUrl}</code>
        {dados.hasCredentials
          ? ' — com Basic Auth, usando a Identity como usuário.'
          : ' — sem autenticação, pois este carregador não tem credencial cadastrada.'}
      </div>

      <Cartao titulo="Conectores">
        {dados.connectors.length === 0 ? (
          <Vazio>
            Nenhum conector. O carregador anuncia os seus via StatusNotification ao conectar.
          </Vazio>
        ) : (
          <div className="tabela-scroll">
            <table>
              <thead>
                <tr>
                  <th>Conector</th>
                  <th>Tipo</th>
                  <th className="numero">Potência</th>
                  <th>Situação</th>
                  <th>Desde</th>
                  <th>Operação</th>
                </tr>
              </thead>
              <tbody>
                {dados.connectors.map((k) => (
                  <tr key={k.id}>
                    <td>#{k.connectorNumber}</td>
                    <td>{k.connectorType ?? '—'}</td>
                    <td className="numero">{formatKw(k.ratedPowerKw)}</td>
                    <td>
                      <Badge tone={connectorTone(k.status)}>{k.statusLabel}</Badge>
                      {k.errorCode && (
                        <span style={{ color: 'var(--erro)', fontSize: 11, marginLeft: 6 }}>
                          {k.errorCode}
                        </span>
                      )}
                    </td>
                    <td>{formatRelative(k.lastStatusAt)}</td>
                    <td>
                      {!podeOperar ? (
                        <span style={{ color: 'var(--texto-suave)', fontSize: 12 }}>
                          somente leitura
                        </span>
                      ) : k.activeSessionId ? (
                        <div className="acoes">
                          <button
                            className="btn btn-perigo btn-mini"
                            onClick={() => void parar(k.activeSessionId!)}
                            disabled={ocupado}
                          >
                            Parar recarga
                          </button>
                          <Link
                            className="btn btn-sec btn-mini"
                            href={`/painel/sessoes/${k.activeSessionId}`}
                          >
                            Acompanhar
                          </Link>
                        </div>
                      ) : (
                        <button
                          className="btn btn-mini"
                          onClick={() => void iniciar(k.id)}
                          disabled={ocupado || !dados.liveConnected}
                          title={
                            dados.liveConnected
                              ? 'Inicia uma recarga manual, sem pagamento'
                              : 'O carregador está desconectado'
                          }
                        >
                          Iniciar recarga
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {podeOperar && (
          <p className="ajuda" style={{ marginTop: 12, fontSize: 12, color: 'var(--texto-suave)' }}>
            O início manual não envolve pagamento. A sessão fica marcada como sem pagamento para
            aparecer na conciliação.
          </p>
        )}
      </Cartao>
    </>
  );
}
