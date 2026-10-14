import { parseEnv, type Env } from '@bora/config';

/**
 * Configuração resolvida em tempo de carregamento do módulo.
 *
 * Existe porque decorators do Nest (@Throttle, por exemplo) são avaliados na
 * definição da classe, antes de qualquer injeção de dependência. Sem isto, os
 * limites acabariam cravados no código — e foi exatamente esse o defeito que
 * fez o rate limit ignorar a configuração de teste.
 *
 * Para tudo que não seja decorator, injete `ENV` (config.module.ts).
 */
export const runtimeEnv: Env = parseEnv();
