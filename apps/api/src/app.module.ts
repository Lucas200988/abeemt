import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ConfigModule } from './config/config.module';
import { runtimeEnv as env } from './config/runtime-env';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { OcppModule } from './modules/ocpp/ocpp.module';
import { AuditModule } from './modules/audit/audit.module';
import { SitesModule } from './modules/sites/sites.module';
import { ChargersModule } from './modules/chargers/chargers.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,

    // Logs estruturados com requestId em toda requisição (briefing seção 13).
    LoggerModule.forRoot({
      pinoHttp: {
        // Silencioso nos testes: a saída do vitest fica ilegível com um log de
        // requisição por asserção.
        level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
        genReqId: (req: IncomingMessage) =>
          (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
        customProps: (req: IncomingMessage) => ({ requestId: (req as { id?: string }).id }),
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.refreshToken',
            'res.headers["set-cookie"]',
          ],
          censor: '[REDIGIDO]',
        },
        // Health checks batem a cada poucos segundos; logá-los enterra o resto.
        autoLogging: {
          ignore: (req: IncomingMessage) => req.url === '/api/health' || req.url === '/api/ready',
        },
        customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
        transport:
          env.NODE_ENV === 'development'
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  translateTime: 'SYS:HH:MM:ss.l',
                  ignore: 'pid,hostname',
                },
              }
            : undefined,
      },
    }),

    // Um único bucket global. As rotas de autenticação apertam o limite com
    // @Throttle, lendo o valor da configuração (ver auth.controller.ts).
    ThrottlerModule.forRoot([
      { name: 'default', ttl: env.RATE_LIMIT_TTL_SECONDS * 1000, limit: env.RATE_LIMIT_MAX },
    ]),

    AuditModule,
    AuthModule,
    HealthModule,
    OcppModule,
    SitesModule,
    ChargersModule,
    SessionsModule,
    DashboardModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Ordem importa: autentica, depois verifica o papel, depois o rate limit.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
