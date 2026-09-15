'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError, loadSession, saveSession } from '@/lib/api';

const MARCA = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Borá Carregar';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<{ mensagem: string; requestId?: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (loadSession()) router.replace('/painel');
  }, [router]);

  async function entrar(event: FormEvent) {
    event.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      saveSession(await api.login(email, senha));
      router.replace('/painel');
    } catch (e) {
      // A API já devolve a frase em português. O detalhe técnico fica separado,
      // como manda a seção 14 do briefing.
      setErro(
        e instanceof ApiRequestError
          ? { mensagem: e.message, requestId: e.requestId }
          : { mensagem: 'Não foi possível conectar ao servidor. Verifique se a API está no ar.' },
      );
    } finally {
      setEnviando(false);
    }
  }

  const [primeiraPalavra, ...resto] = MARCA.split(' ');

  return (
    <main className="tela-centralizada">
      <div className="cartao">
        <h1 className="marca">
          {primeiraPalavra} <span>{resto.join(' ')}</span>
        </h1>
        <p className="subtitulo">Painel administrativo</p>

        {erro && (
          <div className="alerta-erro" role="alert">
            {erro.mensagem}
            {erro.requestId && (
              <code className="detalhe-tecnico">Diagnóstico: {erro.requestId}</code>
            )}
          </div>
        )}

        <form onSubmit={entrar}>
          <div className="campo">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              disabled={enviando}
            />
          </div>

          <div className="campo">
            <label htmlFor="senha">Senha</label>
            <input
              id="senha"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              autoComplete="current-password"
              disabled={enviando}
            />
          </div>

          <button className="botao" type="submit" disabled={enviando}>
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  );
}
