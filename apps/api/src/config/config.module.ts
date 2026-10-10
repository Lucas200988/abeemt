import { Global, Module } from '@nestjs/common';
import { loadRootEnv, parseEnv, type Env } from '@bora/config';
import { resolve } from 'node:path';

export const ENV = Symbol('ENV');

/**
 * Configuração validada, disponível para injeção.
 *
 * O parse acontece na criação do provider — se a configuração estiver inválida,
 * a aplicação não sobe. É de propósito: subir com JWT_SECRET vazio e descobrir
 * no primeiro login é pior do que não subir.
 */
@Global()
@Module({
  providers: [
    {
      provide: ENV,
      useFactory: (): Env => {
        // Sobe até a raiz do monorepo, onde vive o .env único.
        loadRootEnv(resolve(__dirname, '../../../..'));
        return parseEnv();
      },
    },
  ],
  exports: [ENV],
})
export class ConfigModule {}
