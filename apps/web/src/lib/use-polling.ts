'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, clearSession } from './api';

/**
 * Busca dados e revalida em intervalo fixo.
 *
 * O briefing (FASE 3) aceita "atualização em tempo real ou periódica".
 * Escolhemos periódica: um canal push só para o painel exigiria manter estado de
 * assinatura em memória, que é justamente o que o ADR-0003 evita no MVP. Com um
 * carregador e poucos operadores, o custo de uma consulta a cada poucos segundos
 * é irrelevante — e o comportamento é trivial de entender quando algo falha.
 *
 * Se o volume crescer, o caminho é Server-Sent Events na mesma rota; a mudança
 * fica contida neste hook.
 */
export function usePolling<T>(
  buscar: () => Promise<T>,
  intervaloMs: number,
  /**
   * Identifica o que está sendo buscado. Mudá-la reinicia o ciclo.
   *
   * Uma string em vez de um array de dependências: com array seria preciso
   * espalhá-lo no `useEffect`, o que exige suprimir a regra de lint das
   * dependências — e supressão de lint é o tipo de coisa que envelhece mal.
   */
  chave = '',
) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [naoAutenticado, setNaoAutenticado] = useState(false);

  // Guardamos a função em ref para que mudar a identidade dela entre renders
  // não reinicie o temporizador a cada ciclo.
  const buscarRef = useRef(buscar);
  buscarRef.current = buscar;

  const montado = useRef(true);

  const executar = useCallback(async () => {
    try {
      const resultado = await buscarRef.current();
      if (!montado.current) return;

      setDados(resultado);
      setErro(null);
    } catch (e) {
      if (!montado.current) return;

      if (e instanceof ApiRequestError && e.statusCode === 401) {
        clearSession();
        setNaoAutenticado(true);
        return;
      }

      setErro(
        e instanceof ApiRequestError
          ? e.message
          : 'Não foi possível falar com o servidor. Verifique se a API está no ar.',
      );
    } finally {
      if (montado.current) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    montado.current = true;
    void executar();

    const timer = setInterval(() => void executar(), intervaloMs);

    return () => {
      montado.current = false;
      clearInterval(timer);
    };
  }, [executar, intervaloMs, chave]);

  return { dados, erro, carregando, naoAutenticado, recarregar: executar };
}
