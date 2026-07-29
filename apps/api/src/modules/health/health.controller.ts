import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';
import { OcppCommands } from '../ocpp/ocpp-commands.service';

/** Verificação real de conectividade com o banco — não um `return true`. */
@Injectable()
export class PrismaHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indicator: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const check = this.indicator.check(key);
    const startedAt = Date.now();

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return check.up({ responseTimeMs: Date.now() - startedAt });
    } catch (error) {
      return check.down({
        responseTimeMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : 'falha desconhecida',
      });
    }
  }
}

@ApiTags('Saúde')
// Sem versão: orquestradores e balanceadores esperam um caminho estável.
// Versionar /health significaria reconfigurar infraestrutura a cada versão.
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: PrismaHealthIndicator,
    private readonly ocpp: OcppCommands,
  ) {}

  /**
   * Liveness: o processo está de pé?
   *
   * Não consulta o banco de propósito. Se o Postgres cair, reiniciar a API não
   * resolve nada — e um /health que falha faz o orquestrador entrar em loop de
   * reinício justamente durante o incidente.
   */
  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness — o processo está respondendo' })
  live(): { status: string; uptimeSeconds: number; timestamp: string } {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness: dá para receber tráfego?
   *
   * Aqui sim o banco é verificado. Sem banco, a API não consegue atender nada
   * de útil e deve sair do balanceador.
   *
   * A verificação do Redis entra aqui se e quando ele for adotado (ADR-0003);
   * o status do servidor OCPP, na FASE 2.
   */
  @Public()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness — dependências disponíveis' })
  ready() {
    return this.health.check([() => this.database.isHealthy('database')]);
  }

  /**
   * Estado do servidor OCPP (briefing seção 13).
   *
   * Separado do /ready de propósito: nenhum carregador conectado é normal às
   * 3h da manhã e não pode tirar a API do balanceador.
   */
  @Public()
  @Get('ocpp/status')
  @ApiOperation({ summary: 'Carregadores conectados e comandos pendentes' })
  ocppStatus(): {
    onlineChargers: number;
    pendingCommands: number;
    identities: string[];
    timestamp: string;
  } {
    return { ...this.ocpp.status(), timestamp: new Date().toISOString() };
  }
}
