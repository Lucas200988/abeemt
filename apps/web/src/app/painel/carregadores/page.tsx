'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { formatCents, formatKw, formatRelative } from '@bora/contracts';
import { api, ApiRequestError, loadSession, type SiteView } from '@/lib/api';
import { usePolling } from '@/lib/use-polling';
import { Alerta, Badge, Cartao, Carregando, Vazio, connectorTone } from '@/components/ui';

const INTERVALO_MS = 5000;

export default function CarregadoresPage() {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [credencial, setCredencial] = useState<{ valor: string; url: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const { dados, erro, carregando, recarregar } = usePolling(() => api.chargers(), INTERVALO_MS);

  const papel = loadSession()?.user.role;
  const podeAdministrar = papel === 'ORG_ADMIN' || papel === 'SUPER_ADMIN';

  if (carregando && !dados) return <Carregando />;

  return (
    <>
      <header>
        <h1>Carregadores</h1>
        <p className="descricao">
          Estado de conexão e conectores, atualizado a cada {INTERVALO_MS / 1000} segundos
        </p>
      </header>

      {erro && <Alerta>{erro}</Alerta>}
      {aviso && <Alerta tipo="sucesso">{aviso}</Alerta>}

      {credencial && (
        <Alerta tipo="aviso">
          <strong>Credencial gerada. Copie agora — ela não será mostrada de novo.</strong>
          <code className="detalhe-tecnico">
            URL: {credencial.url}
            {'\n'}Usuário: (a Charge Point Identity)
            {'\n'}Senha: {credencial.valor}
          </code>
        </Alerta>
      )}

      {podeAdministrar && (
        <div className="acoes" style={{ marginBottom: 16 }}>
          <button className="btn" onClick={() => setMostrarForm((v) => !v)}>
            {mostrarForm ? 'Cancelar cadastro' : 'Cadastrar carregador'}
          </button>
        </div>
      )}

      {mostrarForm && (
        <FormularioCarregador
          onCriado={(cred) => {
            setMostrarForm(false);
            setCredencial(cred);
            setAviso('Carregador cadastrado.');
            void recarregar();
          }}
        />
      )}

      {dados && dados.items.length === 0 && (
        <Cartao>
          <Vazio>
            Nenhum carregador cadastrado.
            {podeAdministrar
              ? ' Use "Cadastrar carregador" para começar.'
              : ' Peça ao administrador para cadastrar um.'}
          </Vazio>
        </Cartao>
      )}

      {dados?.items.map((c) => (
        <Cartao
          key={c.id}
          titulo={c.name}
          acao={<Link href={`/painel/carregadores/${c.id}`}>Abrir</Link>}
        >
          <div className="acoes" style={{ marginBottom: 14 }}>
            {/* liveConnected vem do registro em memória: diz se dá para falar
                com o equipamento AGORA, não o que o banco registrou. */}
            <Badge tone={c.liveConnected ? 'ok' : 'bad'}>
              {c.liveConnected ? 'Online' : c.connectionStatusLabel}
            </Badge>
            {c.operationalStatus !== 'AVAILABLE' && (
              <Badge tone="warn">{c.operationalStatusLabel}</Badge>
            )}
            {!c.hasCredentials && <Badge tone="warn">Sem credencial</Badge>}
          </div>

          <div className="defs" style={{ marginBottom: 14 }}>
            <div className="def">
              <div className="rotulo">Identity</div>
              <div className="valor mono">{c.chargePointIdentity}</div>
            </div>
            <div className="def">
              <div className="rotulo">Estabelecimento</div>
              <div className="valor">{c.siteName}</div>
            </div>
            <div className="def">
              <div className="rotulo">Equipamento</div>
              <div className="valor">
                {c.manufacturer || c.model
                  ? `${c.manufacturer ?? ''} ${c.model ?? ''}`.trim()
                  : 'não informado ainda'}
              </div>
            </div>
            <div className="def">
              <div className="rotulo">Última comunicação</div>
              <div className="valor">{formatRelative(c.lastSeenAt)}</div>
            </div>
            <div className="def">
              <div className="rotulo">Teto por sessão</div>
              <div className="valor">
                {formatCents(c.effectivePreAuthCeilingCents)}
                <span style={{ color: 'var(--texto-suave)', fontSize: 11 }}>
                  {' '}
                  ({c.preAuthCeilingSource})
                </span>
              </div>
            </div>
          </div>

          <div className="tabela-scroll">
            <table>
              <thead>
                <tr>
                  <th>Conector</th>
                  <th>Tipo</th>
                  <th className="numero">Potência</th>
                  <th>Situação</th>
                  <th>Desde</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {c.connectors.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <Vazio>
                        Nenhum conector. O carregador anuncia os seus ao conectar, ou você pode
                        cadastrá-los na tela do carregador.
                      </Vazio>
                    </td>
                  </tr>
                )}
                {c.connectors.map((k) => (
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
                      {k.activeSessionId ? (
                        <Link href={`/painel/sessoes/${k.activeSessionId}`}>Sessão ativa</Link>
                      ) : (
                        <Link href={`/painel/carregadores/${c.id}`}>Operar</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Cartao>
      ))}
    </>
  );
}

function FormularioCarregador({
  onCriado,
}: {
  onCriado: (credencial: { valor: string; url: string } | null) => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const { dados: sites } = usePolling<{ items: SiteView[] }>(() => api.sites(), 60_000);

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    setEnviando(true);

    const form = new FormData(event.currentTarget);
    const reais = form.get('preAuthCeilingReais') as string;

    try {
      const criado = await api.createCharger({
        siteId: form.get('siteId'),
        chargePointIdentity: (form.get('chargePointIdentity') as string).trim(),
        name: (form.get('name') as string).trim(),
        manufacturer: (form.get('manufacturer') as string) || undefined,
        model: (form.get('model') as string) || undefined,
        // Reais na tela, centavos inteiros na API (ADR-0005).
        preAuthCeilingCents: reais ? Math.round(Number(reais) * 100) : undefined,
        generateCredential: form.get('generateCredential') === 'on',
        connectors: Array.from({ length: Number(form.get('connectorCount')) }, (_, i) => ({
          connectorNumber: i + 1,
          connectorType: (form.get('connectorType') as string) || undefined,
          ratedPowerKw: Number(form.get('ratedPowerKw')) || undefined,
        })),
      });

      onCriado(criado.credential ? { valor: criado.credential, url: criado.ocppUrl } : null);
    } catch (e) {
      setErro(
        e instanceof ApiRequestError ? e.message : 'Não foi possível cadastrar o carregador.',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Cartao titulo="Novo carregador">
      {erro && <Alerta>{erro}</Alerta>}

      <form onSubmit={enviar}>
        <div className="form-grade">
          <div className="campo">
            <label htmlFor="siteId">Estabelecimento</label>
            <select id="siteId" name="siteId" required>
              {sites?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="chargePointIdentity">Charge Point Identity</label>
            <input id="chargePointIdentity" name="chargePointIdentity" required maxLength={60} />
            <p className="ajuda">
              Exatamente o valor configurado no equipamento. É o que aparece na URL OCPP.
            </p>
          </div>

          <div className="campo">
            <label htmlFor="name">Nome no painel</label>
            <input id="name" name="name" required minLength={2} maxLength={120} />
          </div>

          <div className="campo">
            <label htmlFor="manufacturer">Fabricante</label>
            <input id="manufacturer" name="manufacturer" placeholder="WEG" />
            <p className="ajuda">Preenchido pelo próprio carregador ao conectar.</p>
          </div>

          <div className="campo">
            <label htmlFor="model">Modelo</label>
            <input id="model" name="model" placeholder="WEMOB Station" />
          </div>

          <div className="campo">
            <label htmlFor="connectorCount">Quantos conectores</label>
            <input
              id="connectorCount"
              name="connectorCount"
              type="number"
              min={0}
              max={8}
              defaultValue={2}
            />
          </div>

          <div className="campo">
            <label htmlFor="connectorType">Tipo do conector</label>
            <input id="connectorType" name="connectorType" defaultValue="CCS2" />
          </div>

          <div className="campo">
            <label htmlFor="ratedPowerKw">Potência (kW)</label>
            <input
              id="ratedPowerKw"
              name="ratedPowerKw"
              type="number"
              step="0.1"
              min={0}
              defaultValue={30}
            />
          </div>

          <div className="campo">
            <label htmlFor="preAuthCeilingReais">Teto por sessão (R$)</label>
            <input
              id="preAuthCeilingReais"
              name="preAuthCeilingReais"
              type="number"
              step="0.01"
              min={0}
              placeholder="deixe vazio para herdar"
            />
            <p className="ajuda">
              Vazio herda do estabelecimento; o padrão do sistema é R$ 200,00.
            </p>
          </div>
        </div>

        <div className="campo" style={{ marginTop: 14 }}>
          <label htmlFor="generateCredential" style={{ display: 'flex', gap: 8 }}>
            <input
              id="generateCredential"
              name="generateCredential"
              type="checkbox"
              defaultChecked
              style={{ width: 'auto' }}
            />
            Gerar credencial individual
          </label>
          <p className="ajuda">
            Mostrada uma única vez. Guardamos apenas o hash — perdida, o caminho é gerar outra.
          </p>
        </div>

        <div className="acoes" style={{ marginTop: 18 }}>
          <button className="btn" type="submit" disabled={enviando}>
            {enviando ? 'Cadastrando…' : 'Cadastrar'}
          </button>
        </div>
      </form>
    </Cartao>
  );
}
