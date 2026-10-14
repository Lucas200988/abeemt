'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { formatDateTime } from '@bora/contracts';
import {
  api,
  ApiRequestError,
  loadSession,
  type ChargerView,
  type ProviderInfo,
  type TerminalView,
} from '@/lib/api';
import { Alerta, Badge, Cartao, Carregando, Vazio } from '@/components/ui';

/**
 * Maquininhas (FASE 8).
 *
 * A tela existe para um roteiro concreto: alguém está de pé ao lado do poste,
 * com a maquininha na mão, e precisa ligá-la ao carregador certo. Por isso o
 * código de pareamento é o elemento mais visível da página — grande, legível de
 * longe, com o prazo à vista.
 *
 * O que ela deliberadamente **não** mostra é o token: ele aparece uma única vez,
 * na tela do próprio equipamento, e nunca mais. Guardamos apenas o hash.
 */

/** Rótulo de "visto por último" no vocabulário de quem está em campo. */
function vistoEm(iso: string | null): { texto: string; mudo: boolean } {
  if (!iso) return { texto: 'nunca se conectou', mudo: true };

  const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);

  if (minutos < 2) return { texto: 'agora', mudo: false };
  if (minutos < 60) return { texto: `há ${minutos} min`, mudo: minutos > 15 };

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return { texto: `há ${horas} h`, mudo: true };

  return { texto: formatDateTime(iso), mudo: true };
}

function minutosRestantes(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000));
}

export default function MaquininhasPage() {
  const [terminais, setTerminais] = useState<TerminalView[]>([]);
  const [carregadores, setCarregadores] = useState<ChargerView[]>([]);
  const [provedores, setProvedores] = useState<ProviderInfo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(
    null,
  );

  const papel = loadSession()?.user.role;
  const podeEditar = papel === 'ORG_ADMIN' || papel === 'SUPER_ADMIN';

  async function carregar() {
    setCarregando(true);
    try {
      const r = await api.terminals();
      setTerminais(r.items);
      setErro(null);
    } catch (e) {
      setErro(
        e instanceof ApiRequestError ? e.message : 'Não foi possível carregar as maquininhas.',
      );
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();

    api
      .chargers()
      .then((r) => setCarregadores(r.items))
      .catch(() => undefined);

    api
      .paymentProviders()
      .then(setProvedores)
      .catch(() => undefined);
  }, []);

  async function gerarCodigo(t: TerminalView) {
    if (
      t.paired &&
      !window.confirm(
        `Gerar um código novo desconecta a maquininha "${t.name}" imediatamente. Continuar?`,
      )
    ) {
      return;
    }

    try {
      const r = await api.generatePairingCode(t.id);
      setMensagem({
        tipo: 'sucesso',
        texto: `Código ${r.pairingCode} gerado. Vale por ${minutosRestantes(r.expiresAt)} minutos.`,
      });
      await carregar();
    } catch (e) {
      setMensagem({
        tipo: 'erro',
        texto: e instanceof ApiRequestError ? e.message : 'Não foi possível gerar o código.',
      });
    }
  }

  async function revogar(t: TerminalView) {
    if (
      !window.confirm(
        `Cortar o acesso da maquininha "${t.name}"? Ela para de funcionar na hora. ` +
          'Use isto se o equipamento sumiu.',
      )
    ) {
      return;
    }

    try {
      await api.revokeTerminal(t.id);
      setMensagem({ tipo: 'sucesso', texto: 'Acesso revogado.' });
      await carregar();
    } catch (e) {
      setMensagem({
        tipo: 'erro',
        texto: e instanceof ApiRequestError ? e.message : 'Não foi possível revogar.',
      });
    }
  }

  const provedorTerminal = provedores?.available.find((p) => p.name === provedores.terminal);

  return (
    <>
      <header>
        <h1>Maquininhas</h1>
        <p className="descricao">
          O terminal de pagamento montado no poste. O motorista passa o cartão nele e a recarga
          começa — <strong>sem aplicativo e sem cadastro</strong>. Cada maquininha só consegue
          operar o conector ao qual foi vinculada.
        </p>
      </header>

      {provedorTerminal?.simulated && (
        <Alerta tipo="aviso">
          O provedor de pagamento das maquininhas é <strong>{provedorTerminal.name}</strong>, que é{' '}
          <strong>simulado</strong>: nenhum dinheiro se move. Serve para testar o fluxo antes de
          existir credencial do adquirente.
        </Alerta>
      )}

      {mensagem && <Alerta tipo={mensagem.tipo}>{mensagem.texto}</Alerta>}

      {podeEditar && (
        <FormularioMaquininha
          carregadores={carregadores}
          onSalvo={(texto) => {
            setMensagem({ tipo: 'sucesso', texto });
            void carregar();
          }}
          onErro={(texto) => setMensagem({ tipo: 'erro', texto })}
        />
      )}

      <Cartao titulo="Maquininhas cadastradas">
        {carregando && terminais.length === 0 ? (
          <Carregando />
        ) : erro ? (
          <Alerta>{erro}</Alerta>
        ) : terminais.length === 0 ? (
          <Vazio>
            Nenhuma maquininha cadastrada. Cadastre uma acima e leve o código de pareamento até o
            equipamento.
          </Vazio>
        ) : (
          <div className="tabela-scroll">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Ponto de recarga</th>
                  <th>Situação</th>
                  <th>Pareamento</th>
                  <th>Visto por último</th>
                  <th>Versão</th>
                  {podeEditar && <th />}
                </tr>
              </thead>
              <tbody>
                {terminais.map((t) => {
                  const visto = vistoEm(t.lastSeenAt);

                  return (
                    <tr key={t.id}>
                      <td>
                        {t.name}
                        {t.serialNumber && (
                          <div style={{ fontSize: 11, color: 'var(--texto-suave)' }}>
                            série {t.serialNumber}
                          </div>
                        )}
                      </td>
                      <td>{t.connectorLabel ?? <Badge tone="bad">sem conector</Badge>}</td>
                      <td>
                        {t.status !== 'ACTIVE' ? (
                          <Badge tone="neutral">Desativada</Badge>
                        ) : t.paired ? (
                          <Badge tone="ok">Pareada</Badge>
                        ) : (
                          <Badge tone="warn">Aguardando pareamento</Badge>
                        )}
                      </td>
                      <td>
                        {/* O código é o que alguém vai ler de longe e digitar
                            num teclado pequeno. Por isso o destaque. */}
                        {t.pairingCode ? (
                          <>
                            <code className="codigo-pareamento">{t.pairingCode}</code>
                            <div style={{ fontSize: 11, color: 'var(--texto-suave)' }}>
                              expira em {minutosRestantes(t.pairingExpiresAt!)} min
                            </div>
                          </>
                        ) : t.paired ? (
                          <span style={{ color: 'var(--texto-suave)', fontSize: 12 }}>
                            {t.pairedAt ? formatDateTime(t.pairedAt) : '—'}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--texto-suave)', fontSize: 12 }}>
                            sem código válido
                          </span>
                        )}
                      </td>
                      <td>
                        {visto.mudo && t.paired ? (
                          <Badge tone="warn">{visto.texto}</Badge>
                        ) : (
                          <span style={{ fontSize: 12 }}>{visto.texto}</span>
                        )}
                      </td>
                      <td style={{ fontSize: 12 }}>{t.appVersion ?? '—'}</td>
                      {podeEditar && (
                        <td>
                          <div className="acoes">
                            <button
                              className="btn btn-sec btn-mini"
                              onClick={() => void gerarCodigo(t)}
                            >
                              Gerar código
                            </button>
                            {t.paired && (
                              <button
                                className="btn btn-sec btn-mini"
                                onClick={() => void revogar(t)}
                              >
                                Revogar
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      <Cartao titulo="Como parear uma maquininha">
        <ol className="passos">
          <li>Cadastre a maquininha acima, escolhendo o conector em que ela está montada.</li>
          <li>
            Anote o código de 8 caracteres. Ele vale por poucos minutos e serve{' '}
            <strong>uma única vez</strong>.
          </li>
          <li>
            No aplicativo instalado na maquininha, abra o pareamento e digite o código. O
            equipamento recebe a credencial de acesso e a guarda.
          </li>
          <li>
            {/* `{' '}` explícito: num nó de texto que continua na linha
                seguinte, o compilador do JSX descarta o espaço inicial e o
                texto sai colado no elemento anterior. */}
            A situação muda para <strong>Pareada</strong>{' '}
            {'e o “visto por último” passa a ser atualizado.'}
          </li>
        </ol>
        <p className="descricao" style={{ marginTop: 12 }}>
          Se o equipamento sumir, use <strong>Revogar</strong>: o acesso é cortado na hora, sem
          esperar prazo nenhum.
        </p>
      </Cartao>
    </>
  );
}

// ===========================================================================

function FormularioMaquininha({
  carregadores,
  onSalvo,
  onErro,
}: {
  carregadores: ChargerView[];
  onSalvo: (texto: string) => void;
  onErro: (texto: string) => void;
}) {
  const [nome, setNome] = useState('');
  const [connectorId, setConnectorId] = useState('');
  const [modelo, setModelo] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();

    // Capturado ANTES do await: depois de qualquer await o React já limpou o
    // evento sintético e `currentTarget` é nulo.
    const formulario = evento.currentTarget;

    if (!connectorId) {
      onErro('Escolha o conector em que a maquininha está montada.');
      return;
    }

    setEnviando(true);
    try {
      const criado = await api.createTerminal({
        name: nome,
        connectorId,
        model: modelo || undefined,
      });

      formulario.reset();
      setNome('');
      setConnectorId('');
      setModelo('');

      onSalvo(
        criado.pairingCode
          ? `Maquininha cadastrada. Código de pareamento: ${criado.pairingCode}`
          : 'Maquininha cadastrada.',
      );
    } catch (e) {
      onErro(e instanceof ApiRequestError ? e.message : 'Não foi possível cadastrar.');
    } finally {
      setEnviando(false);
    }
  }

  const conectores = carregadores.flatMap((c) =>
    c.connectors.map((con) => ({
      id: con.id,
      label: `${c.name} — conector ${con.connectorNumber}`,
    })),
  );

  return (
    <Cartao titulo="Cadastrar maquininha">
      <form onSubmit={enviar}>
        <div className="form-grade">
          <div className="campo">
            <label htmlFor="nome">Nome</label>
            <input
              id="nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Maquininha do poste 1"
              required
              maxLength={120}
            />
          </div>

          <div className="campo">
            <label htmlFor="connectorId">Conector</label>
            <select
              id="connectorId"
              value={connectorId}
              onChange={(e) => setConnectorId(e.target.value)}
              required
            >
              <option value="">Selecione…</option>
              {conectores.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <p className="ajuda">
              A maquininha só consegue operar este conector — é a garantia de que um equipamento
              furtado não liga o carregador do vizinho.
            </p>
          </div>

          <div className="campo">
            <label htmlFor="modelo">Modelo (opcional)</label>
            <input
              id="modelo"
              value={modelo}
              onChange={(e) => setModelo(e.target.value)}
              placeholder="PagBank Moderninha Smart 2"
              maxLength={120}
            />
          </div>
        </div>

        {conectores.length === 0 && (
          <p className="ajuda" style={{ marginTop: 10 }}>
            Nenhum conector cadastrado ainda. Cadastre um carregador antes de vincular a maquininha.
          </p>
        )}

        <div className="acoes" style={{ marginTop: 16 }}>
          <button className="btn" type="submit" disabled={enviando || conectores.length === 0}>
            {enviando ? 'Cadastrando…' : 'Cadastrar e gerar código'}
          </button>
        </div>
      </form>
    </Cartao>
  );
}
