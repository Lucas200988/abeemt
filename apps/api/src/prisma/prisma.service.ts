import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@bora/database';

/**
 * Cliente Prisma como serviço do Nest.
 *
 * O ciclo de vida fica atrelado ao da aplicação: conecta no boot e desconecta
 * no encerramento. Sem isso, um shutdown deixa conexões penduradas no Postgres.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
