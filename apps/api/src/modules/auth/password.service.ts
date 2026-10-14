import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Hash de senha com Argon2id.
 *
 * Parâmetros explícitos, não os padrões da biblioteca: os valores abaixo são a
 * recomendação da OWASP para Argon2id (19 MiB, 2 iterações, paralelismo 1).
 * Deixar implícito significa que uma atualização da lib muda silenciosamente a
 * segurança de todas as senhas novas.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  /**
   * Verifica a senha. Nunca lança: um hash corrompido no banco deve resultar
   * em "senha errada", não em erro 500 que revela o estado interno.
   */
  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain, ARGON2_OPTIONS);
    } catch {
      return false;
    }
  }
}
