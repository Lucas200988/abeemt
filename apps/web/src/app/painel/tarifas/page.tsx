'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { formatCents, formatDate } from '@bora/contracts';
import {
  api,
  ApiRequestError,
  loadSession,
  type PricingBreakdown,
  type SiteView,
  type TariffView,
} from '@/lib/api';
import { Alerta, Badge, Cartao, Carregando, Vazio } from '@/components/ui';

/**
 * Tarifas (FASE 6).
 *
 * A tela precisa responder três perguntas do operador, e é por isso que ela não
 * é só uma tabela de campos:
 *
 *  1. Qual tarifa está valendo agora? ("ativa" e "valendo" não são a mesma coisa)
 *  2. Quanto sai uma recarga típica com esse preço? (o simulador)
 *  3. O que acontece com as recargas já feitas se eu mudar? (nada — está escrito)
 */

/** Converte "12,50" ou "12.50" em 1250 centavos, sem passar por ponto flutuante duvidoso. */
function reaisParaCentavos(texto: string): number | null {
  const limpo = texto.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  if (limpo === '') return 0;

  const numero = Number(limpo);
  if (!Number.isFinite(numero) || numero < 0) return null;

  // Arredondamento explícito: o operador digita reais, o sistema guarda centavos.
  return Math.round(numero * 100);
}

function centavosParaReais(centavos: number): string {
  return (centavos / 100).toFixed(2).replace('.', ',');
}

export default function TarifasPage() {
  const [tarifas, setTarifas] = useState<TariffView[]>([]);
  const [sites, setSites] = useState<SiteView[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(
    null,
  );
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const [editando, setEditando] = useState<TariffView | null>(null);

  const papel = loadSession()?.user.role;
  const podeEditar = papel === 'ORG_ADMIN' || papel === 'SUPER_ADMIN';

  /**
   * Recarrega a lista.
   *
   * Recebe o filtro por parâmetro em vez de ler o estado: assim a função não é
   * dependência do efeito, e o painel não precisa de uma regra de lint
   * desabilitada para funcionar.
   */
  async function carregar(incluirInativas: boolean) {
    setCarregando(true);
    try {
      const r = await api.tariffs({ includeInactive: incluirInativas });
      setTarifas(r.items);
      setErro(null);
    } catch (e) {
      setErro(e instanceof ApiRequestError ? e.message : 'Não foi possível carregar as tarifas.');
    } finally {
      setCarregando(false);
    }
  }

  const recarregar = () => carregar(mostrarInativas);

  useEffect(() => {
    void carregar(mostrarInativas);
  }, [mostrarInativas]);

  useEffect(() => {
    api
      .sites()
      .then((r) => setSites(r.items))
      .catch(() => undefined);
  }, []);

  async function desativar(t: TariffView) {
    if (!window.confirm(`Desativar a tarifa "${t.name}"? As recargas já feitas não mudam.`)) return;

    try {
      await api.deactivateTariff(t.id);
      setMensagem({ tipo: 'sucesso', texto: 'Tarifa desativada.' });
      await recarregar();
    } catch (e) {
      setMensagem({
        tipo: 'erro',
        texto: e instanceof ApiRequestError ? e.message : 'Não foi possível desativar.',
      });
    }
  }

  return (
    <>
      <header>
        <h1>Tarifas</h1>
        <p className="descricao">
          O preço que cada recarga paga. Alterar uma tarifa <strong>não muda</strong> o valor de
          recargas já realizadas — cada sessão guarda uma cópia das condições do momento.
        </p>
      </header>

      {mensagem && <Alerta tipo={mensagem.tipo}>{mensagem.texto}</Alerta>}

      {podeEditar && (
        <FormularioTarifa
          sites={sites}
          ehAdminGlobal={papel === 'SUPER_ADMIN'}
          editando={editando}
          onCancelar={() => setEditando(null)}
          onSalvo={(texto) => {
            setEditando(null);
            setMensagem({ tipo: 'sucesso', texto });
            void recarregar();
          }}
          onErro={(texto) => setMensagem({ tipo: 'erro', texto })}
        />
      )}

      <Cartao
        titulo="Tarifas cadastradas"
        acao={
          <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={mostrarInativas}
              onChange={(e) => setMostrarInativas(e.target.checked)}
            />
            mostrar desativadas
          </label>
        }
      >
        {carregando && tarifas.length === 0 ? (
          <Carregando />
        ) : erro ? (
          <Alerta>{erro}</Alerta>
        ) : tarifas.length === 0 ? (
          <Vazio>
            Nenhuma tarifa cadastrada. Sem tarifa, toda recarga é calculada como R$ 0,00.
          </Vazio>
        ) : (
          <div className="tabela-scroll">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Abrangência</th>
                  <th className="numero">Por kWh</th>
                  <th className="numero">Conexão</th>
                  <th className="numero">Por minuto</th>
                  <th className="numero">Ociosidade</th>
                  <th className="numero">Mínimo</th>
                  <th className="numero">Máximo</th>
                  <th>Situação</th>
                  <th className="numero">Recargas</th>
                  {podeEditar && <th />}
                </tr>
              </thead>
              <tbody>
                {tarifas.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{t.scopeLabel}</td>
                    <td className="numero">{formatCents(t.pricePerKwhCents)}</td>
                    <td className="numero">
                      {t.connectionFeeCents ? formatCents(t.connectionFeeCents) : '—'}
                    </td>
                    <td className="numero">
                      {t.pricePerMinuteCents ? formatCents(t.pricePerMinuteCents) : '—'}
                    </td>
                    <td className="numero">
                      {t.idleFeePerMinuteCents ? formatCents(t.idleFeePerMinuteCents) : '—'}
                    </td>
                    <td className="numero">
                      {t.minimumAmountCents ? formatCents(t.minimumAmountCents) : '—'}
                    </td>
                    <td className="numero">
                      {t.maximumAmountCents === null ? '—' : formatCents(t.maximumAmountCents)}
                    </td>
                    <td>
                      {/* "Ativa" e "valendo agora" são coisas diferentes: uma
                          tarifa com início no mês que vem está ativa e não é
                          aplicada a nenhuma recarga hoje. */}
                      {!t.active ? (
                        <Badge tone="neutral">Desativada</Badge>
                      ) : t.inEffect ? (
                        <Badge tone="ok">Valendo</Badge>
                      ) : (
                        <Badge tone="warn">Fora do período</Badge>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--texto-suave)', marginTop: 3 }}>
                        desde {formatDate(t.validFrom)}
                        {t.validUntil && ` até ${formatDate(t.validUntil)}`}
                      </div>
                    </td>
                    <td className="numero">{t.sessionCount}</td>
                    {podeEditar && (
                      <td>
                        <div className="acoes">
                          <button
                            className="btn btn-sec btn-mini"
                            onClick={() => setEditando(t)}
                          >
                            Editar
                          </button>
                          {t.active && (
                            <button
                              className="btn btn-sec btn-mini"
                              onClick={() => void desativar(t)}
                            >
                              Desativar
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      {tarifas.length > 0 && <Simulador tarifas={tarifas} />}
    </>
  );
}

// ===========================================================================

function FormularioTarifa({
  sites,
  ehAdminGlobal,
  editando,
  onSalvo,
  onErro,
  onCancelar,
}: {
  sites: SiteView[];
  /** O administrador global não tem organização própria e precisa escolher uma. */
  ehAdminGlobal: boolean;
  editando: TariffView | null;
  onSalvo: (texto: string) => void;
  onErro: (texto: string) => void;
  onCancelar: () => void;
}) {
  const [enviando, setEnviando] = useState(false);

  /**
   * Organizações visíveis, deduzidas dos estabelecimentos.
   *
   * O administrador global enxerga várias e não pertence a nenhuma — sem
   * escolher uma, a API recusa a criação. Antes de existir este campo, a opção
   * "Toda a organização" ficava impossível de usar para esse perfil: a tela
   * oferecia um caminho que sempre dava erro.
   */
  const organizacoes = [...new Map(sites.map((s) => [s.organizationId, s.organizationName])).entries()];

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();

    /**
     * O elemento é guardado ANTES de qualquer `await`.
     *
     * Depois de um await, `evento.currentTarget` é nulo — o React só o mantém
     * durante o despacho do evento. Chamar `.reset()` nele mais tarde lançava
     * TypeError, que caía no `catch` e mostrava "não foi possível salvar" para
     * uma tarifa que tinha sido criada com sucesso.
     */
    const elemento = evento.currentTarget;
    const form = new FormData(elemento);

    const campos = {
      pricePerKwhCents: reaisParaCentavos(String(form.get('pricePerKwh') ?? '')),
      connectionFeeCents: reaisParaCentavos(String(form.get('connectionFee') ?? '')),
      pricePerMinuteCents: reaisParaCentavos(String(form.get('pricePerMinute') ?? '')),
      idleFeePerMinuteCents: reaisParaCentavos(String(form.get('idleFee') ?? '')),
      minimumAmountCents: reaisParaCentavos(String(form.get('minimum') ?? '')),
    };

    if (Object.values(campos).some((v) => v === null)) {
      onErro('Há um valor inválido no formulário. Use o formato 12,50.');
      return;
    }

    const maximoTexto = String(form.get('maximum') ?? '').trim();
    const maximumAmountCents = maximoTexto === '' ? null : reaisParaCentavos(maximoTexto);

    if (maximumAmountCents === null && maximoTexto !== '') {
      onErro('Valor máximo inválido.');
      return;
    }

    const siteId = String(form.get('siteId') ?? '');
    const organizationId = String(form.get('organizationId') ?? '');

    setEnviando(true);
    try {
      if (editando) {
        await api.updateTariff(editando.id, {
          name: String(form.get('name')),
          ...campos,
          maximumAmountCents,
        });
        onSalvo('Tarifa atualizada. As recargas já realizadas continuam com o valor antigo.');
      } else {
        await api.createTariff({
          name: String(form.get('name')),
          siteId: siteId || undefined,
          organizationId: organizationId || undefined,
          ...campos,
          maximumAmountCents: maximumAmountCents ?? undefined,
        });
        onSalvo('Tarifa criada. A próxima recarga já usa este preço.');
      }
      elemento.reset();
    } catch (e) {
      onErro(e instanceof ApiRequestError ? e.message : 'Não foi possível salvar a tarifa.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Cartao
      titulo={editando ? `Editando "${editando.name}"` : 'Nova tarifa'}
      acao={
        editando ? (
          <button className="btn btn-sec btn-mini" onClick={onCancelar}>
            Cancelar edição
          </button>
        ) : undefined
      }
    >
      {/* `key` força o formulário a remontar ao trocar de tarifa — sem isso, os
          defaultValue não acompanham a seleção. */}
      <form onSubmit={enviar} key={editando?.id ?? 'nova'}>
        <div className="form-grade">
          <div className="campo">
            <label htmlFor="name">Nome da tarifa</label>
            <input
              id="name"
              name="name"
              required
              maxLength={120}
              defaultValue={editando?.name}
              placeholder="Tarifa padrão 2026"
            />
          </div>

          {!editando && ehAdminGlobal && (
            <div className="campo">
              <label htmlFor="organizationId">Organização</label>
              <select id="organizationId" name="organizationId" defaultValue="" required>
                <option value="">Selecione…</option>
                {organizacoes.map(([id, nome]) => (
                  <option key={id} value={id}>
                    {nome}
                  </option>
                ))}
              </select>
              <p className="ajuda">
                Obrigatório para o administrador global, que não pertence a nenhuma organização.
              </p>
            </div>
          )}

          {!editando && (
            <div className="campo">
              <label htmlFor="siteId">Abrangência</label>
              <select id="siteId" name="siteId" defaultValue="">
                <option value="">Toda a organização</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    Somente {s.name}
                  </option>
                ))}
              </select>
              <p className="ajuda">A tarifa de um estabelecimento vence a geral da organização.</p>
            </div>
          )}

          <div className="campo">
            <label htmlFor="pricePerKwh">Preço por kWh (R$)</label>
            <input
              id="pricePerKwh"
              name="pricePerKwh"
              required
              inputMode="decimal"
              defaultValue={editando ? centavosParaReais(editando.pricePerKwhCents) : '2,50'}
            />
          </div>

          <div className="campo">
            <label htmlFor="connectionFee">Taxa de conexão (R$)</label>
            <input
              id="connectionFee"
              name="connectionFee"
              inputMode="decimal"
              defaultValue={editando ? centavosParaReais(editando.connectionFeeCents) : '0,00'}
            />
            <p className="ajuda">Cobrada uma vez por recarga. Não se aplica se nada for entregue.</p>
          </div>

          <div className="campo">
            <label htmlFor="pricePerMinute">Preço por minuto carregando (R$)</label>
            <input
              id="pricePerMinute"
              name="pricePerMinute"
              inputMode="decimal"
              defaultValue={editando ? centavosParaReais(editando.pricePerMinuteCents) : '0,00'}
            />
          </div>

          <div className="campo">
            <label htmlFor="idleFee">Ociosidade por minuto (R$)</label>
            <input
              id="idleFee"
              name="idleFee"
              inputMode="decimal"
              defaultValue={editando ? centavosParaReais(editando.idleFeePerMinuteCents) : '0,00'}
            />
            <p className="ajuda">
              Veículo plugado sem carregar. Sai do tempo cobrado como recarga, não soma por cima.
            </p>
          </div>

          <div className="campo">
            <label htmlFor="minimum">Valor mínimo (R$)</label>
            <input
              id="minimum"
              name="minimum"
              inputMode="decimal"
              defaultValue={editando ? centavosParaReais(editando.minimumAmountCents) : '0,00'}
            />
          </div>

          <div className="campo">
            <label htmlFor="maximum">Valor máximo (R$)</label>
            <input
              id="maximum"
              name="maximum"
              inputMode="decimal"
              placeholder="sem teto"
              defaultValue={
                editando === null || editando.maximumAmountCents === null
                  ? ''
                  : centavosParaReais(editando.maximumAmountCents)
              }
            />
            <p className="ajuda">
              Teto comercial. Se for menor que o valor pré-autorizado, é ele que vale.
            </p>
          </div>
        </div>

        <div className="acoes">
          <button className="btn" type="submit" disabled={enviando}>
            {enviando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Criar tarifa'}
          </button>
        </div>

        <p style={{ fontSize: 12, color: 'var(--texto-suave)', marginTop: 10 }}>
          Os valores fracionados são arredondados <strong>para baixo</strong> no fechamento — na
          dúvida, a favor do motorista.
        </p>
      </form>
    </Cartao>
  );
}

// ===========================================================================

/** Cenários típicos, para o operador não precisar inventar números. */
const CENARIOS = [
  { rotulo: 'Recarga rápida — 10 kWh em 20 min', energyWh: 10_000, durationSeconds: 1200 },
  { rotulo: 'Recarga cheia — 40 kWh em 1h20', energyWh: 40_000, durationSeconds: 4800 },
  { rotulo: 'Passada curta — 2 kWh em 5 min', energyWh: 2000, durationSeconds: 300 },
  {
    rotulo: 'Carro cheio esquecido — 30 kWh em 3h, 2h parado',
    energyWh: 30_000,
    durationSeconds: 10_800,
    idleSeconds: 7200,
  },
];

function Simulador({ tarifas }: { tarifas: TariffView[] }) {
  const [tariffId, setTariffId] = useState(tarifas[0]?.id ?? '');
  const [resultados, setResultados] = useState<(PricingBreakdown | null)[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!tariffId) return;

    Promise.all(
      CENARIOS.map((c) =>
        api
          .simulateTariff(tariffId, {
            energyWh: c.energyWh,
            durationSeconds: c.durationSeconds,
            idleSeconds: c.idleSeconds,
          })
          .catch(() => null),
      ),
    )
      .then(setResultados)
      .catch(() => setErro('Não foi possível simular.'));
  }, [tariffId]);

  return (
    <Cartao titulo="Quanto sai na prática">
      <div className="campo" style={{ maxWidth: 380 }}>
        <label htmlFor="simTariff">Tarifa</label>
        <select id="simTariff" value={tariffId} onChange={(e) => setTariffId(e.target.value)}>
          {tarifas.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — {t.scopeLabel}
            </option>
          ))}
        </select>
      </div>

      {erro && <Alerta>{erro}</Alerta>}

      <div className="tabela-scroll">
        <table>
          <thead>
            <tr>
              <th>Cenário</th>
              <th className="numero">Conexão</th>
              <th className="numero">Energia</th>
              <th className="numero">Tempo</th>
              <th className="numero">Ociosidade</th>
              <th className="numero">Total</th>
            </tr>
          </thead>
          <tbody>
            {CENARIOS.map((c, i) => {
              const r = resultados[i];
              return (
                <tr key={c.rotulo}>
                  <td>{c.rotulo}</td>
                  <td className="numero">{r ? formatCents(r.connectionFeeCents) : '—'}</td>
                  <td className="numero">{r ? formatCents(r.energyCents) : '—'}</td>
                  <td className="numero">{r ? formatCents(r.timeCents) : '—'}</td>
                  <td className="numero">{r ? formatCents(r.idleCents) : '—'}</td>
                  <td className="numero">
                    <strong>{r ? formatCents(r.totalCents) : '—'}</strong>
                    {r?.minimumApplied && (
                      <div style={{ fontSize: 11, color: 'var(--texto-suave)' }}>mínimo aplicado</div>
                    )}
                    {r?.tariffMaximumApplied && (
                      <div style={{ fontSize: 11, color: 'var(--texto-suave)' }}>máximo aplicado</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12, color: 'var(--texto-suave)', marginTop: 10 }}>
        A simulação usa exatamente a mesma conta do fechamento real — se divergisse, ela não
        serviria para nada.
      </p>
    </Cartao>
  );
}
