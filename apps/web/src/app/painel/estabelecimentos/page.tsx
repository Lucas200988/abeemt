'use client';

import { useState, type FormEvent } from 'react';
import { formatCents, formatDate } from '@bora/contracts';
import { api, ApiRequestError, loadSession } from '@/lib/api';
import { usePolling } from '@/lib/use-polling';
import { Alerta, Badge, Cartao, Carregando, Vazio } from '@/components/ui';

export default function EstabelecimentosPage() {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const { dados, erro, carregando, recarregar } = usePolling(() => api.sites(), 30_000);

  const papel = loadSession()?.user.role;
  const podeAdministrar = papel === 'ORG_ADMIN' || papel === 'SUPER_ADMIN';

  if (carregando && !dados) return <Carregando />;

  return (
    <>
      <header>
        <h1>Estabelecimentos</h1>
        <p className="descricao">Hotéis, restaurantes, condomínios — onde os carregadores ficam</p>
      </header>

      {erro && <Alerta>{erro}</Alerta>}
      {aviso && <Alerta tipo="sucesso">{aviso}</Alerta>}

      {podeAdministrar && (
        <div className="acoes" style={{ marginBottom: 16 }}>
          <button className="btn" onClick={() => setMostrarForm((v) => !v)}>
            {mostrarForm ? 'Cancelar' : 'Cadastrar estabelecimento'}
          </button>
        </div>
      )}

      {mostrarForm && (
        <FormularioSite
          onCriado={() => {
            setMostrarForm(false);
            setAviso('Estabelecimento cadastrado.');
            void recarregar();
          }}
        />
      )}

      <Cartao>
        {!dados || dados.items.length === 0 ? (
          <Vazio>Nenhum estabelecimento cadastrado.</Vazio>
        ) : (
          <div className="tabela-scroll">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Cidade</th>
                  <th>Fuso</th>
                  <th className="numero">Carregadores</th>
                  <th>Teto por sessão</th>
                  <th>Situação</th>
                  <th>Cadastro</th>
                </tr>
              </thead>
              <tbody>
                {dados.items.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.name}
                      {s.legalName && (
                        <div style={{ fontSize: 11, color: 'var(--texto-suave)' }}>
                          {s.legalName}
                        </div>
                      )}
                    </td>
                    <td>{s.city ? `${s.city}${s.state ? `/${s.state}` : ''}` : '—'}</td>
                    <td style={{ fontSize: 12 }}>{s.timezone}</td>
                    <td className="numero">{s.chargerCount}</td>
                    <td>
                      {s.preAuthCeilingCents === null ? (
                        <span style={{ color: 'var(--texto-suave)', fontSize: 12 }}>
                          herda o padrão
                        </span>
                      ) : (
                        formatCents(s.preAuthCeilingCents)
                      )}
                    </td>
                    <td>
                      <Badge tone={s.status === 'ACTIVE' ? 'ok' : 'neutral'}>
                        {s.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </td>
                    <td>{formatDate(s.createdAt)}</td>
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

function FormularioSite({ onCriado }: { onCriado: () => void }) {
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    setEnviando(true);

    const form = new FormData(event.currentTarget);
    const reais = form.get('preAuthCeilingReais') as string;

    try {
      await api.createSite({
        name: (form.get('name') as string).trim(),
        legalName: (form.get('legalName') as string) || undefined,
        taxId: (form.get('taxId') as string) || undefined,
        address: (form.get('address') as string) || undefined,
        city: (form.get('city') as string) || undefined,
        state: (form.get('state') as string) || undefined,
        timezone: (form.get('timezone') as string) || undefined,
        // Reais na tela, centavos inteiros na API (ADR-0005).
        preAuthCeilingCents: reais ? Math.round(Number(reais) * 100) : undefined,
      });
      onCriado();
    } catch (e) {
      setErro(
        e instanceof ApiRequestError ? e.message : 'Não foi possível cadastrar o estabelecimento.',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Cartao titulo="Novo estabelecimento">
      {erro && <Alerta>{erro}</Alerta>}

      <form onSubmit={enviar}>
        <div className="form-grade">
          <div className="campo">
            <label htmlFor="name">Nome comercial</label>
            <input id="name" name="name" required minLength={2} maxLength={120} />
          </div>
          <div className="campo">
            <label htmlFor="legalName">Razão social</label>
            <input id="legalName" name="legalName" maxLength={160} />
          </div>
          <div className="campo">
            <label htmlFor="taxId">CNPJ</label>
            <input id="taxId" name="taxId" maxLength={18} placeholder="opcional no MVP" />
          </div>
          <div className="campo">
            <label htmlFor="address">Endereço</label>
            <input id="address" name="address" maxLength={200} />
          </div>
          <div className="campo">
            <label htmlFor="city">Cidade</label>
            <input id="city" name="city" maxLength={80} />
          </div>
          <div className="campo">
            <label htmlFor="state">UF</label>
            <input id="state" name="state" maxLength={2} minLength={2} placeholder="MT" />
          </div>
          <div className="campo">
            <label htmlFor="timezone">Fuso horário</label>
            <input id="timezone" name="timezone" defaultValue="America/Cuiaba" maxLength={60} />
            <p className="ajuda">Define o recorte de "hoje" nos relatórios.</p>
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
            <p className="ajuda">O padrão do sistema é R$ 200,00.</p>
          </div>
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
