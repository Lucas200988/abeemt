import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { runtimeEnv } from '../../config/runtime-env';
import { Public } from '../../common/decorators/public.decorator';
import { TerminalsService } from './terminals.service';
import { TerminalSessionService } from './terminal-session.service';
import { TerminalGuard, type TerminalIdentity } from './terminal.guard';
import { CurrentTerminal } from './current-terminal.decorator';
import {
  PairTerminalDto,
  TerminalAuthorizationDto,
  TerminalHeartbeatDto,
  TerminalStopSessionDto,
} from './dto/terminal.dto';

/**
 * Pareamento da maquininha.
 *
 * Separado do resto num controller próprio porque é o único endpoint do terminal
 * que **não** exige token: é justamente onde o token é obtido. Deixá-lo junto
 * com os demais exigiria uma exceção dentro do guard, e exceção dentro de guard
 * é como endpoint fica aberto sem ninguém perceber.
 */
@ApiTags('Maquininha')
@Controller('terminal')
export class TerminalPairingController {
  constructor(private readonly terminals: TerminalsService) {}

  @Public()
  /**
   * Limite apertado, igual ao do login.
   *
   * O código de pareamento tem cerca de 39 bits — muito para tentativa e erro,
   * mas é uma credencial curta e o limitador é o que garante que continue assim.
   */
  @Throttle({
    default: {
      limit: runtimeEnv.RATE_LIMIT_AUTH_MAX,
      ttl: runtimeEnv.RATE_LIMIT_TTL_SECONDS * 1000,
    },
  })
  @Post('pair')
  @ApiOperation({
    summary: 'Troca o código de pareamento pelo token de acesso do terminal',
    description:
      'O token é devolvido UMA ÚNICA VEZ. O código é de uso único e expira. ' +
      'Perdido o token, gere outro código no painel.',
  })
  pair(@Body() dto: PairTerminalDto) {
    return this.terminals.pair(dto);
  }
}

/**
 * O que a maquininha faz depois de pareada.
 *
 * `@Public()` desliga o guard de JWT — o terminal não é usuário e não tem token
 * de painel. `TerminalGuard` entra no lugar: sem ele, estes endpoints ficariam
 * de fato abertos.
 */
@ApiTags('Maquininha')
@ApiSecurity('terminal-token')
@Public()
@UseGuards(TerminalGuard)
@Controller('terminal')
export class TerminalApiController {
  constructor(
    private readonly terminals: TerminalsService,
    private readonly sessions: TerminalSessionService,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Contexto do terminal: conector, tarifa, valor a pré-autorizar',
    description:
      'A tela do equipamento monta o preço e o valor da reserva a partir daqui. ' +
      'Nada disso é decidido no aplicativo — mudar o teto não pode exigir atualizar ' +
      'a maquininha de cada poste.',
  })
  me(@CurrentTerminal() terminal: TerminalIdentity) {
    return this.sessions.context(terminal);
  }

  @Post('heartbeat')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sinal de vida',
    description: 'Alimenta o "visto por último" do painel, para terminal mudo aparecer.',
  })
  async heartbeat(
    @CurrentTerminal() terminal: TerminalIdentity,
    @Body() dto: TerminalHeartbeatDto,
  ): Promise<void> {
    await this.terminals.touch(terminal.id, dto.appVersion);
  }

  @Post('authorization')
  @ApiOperation({
    summary: 'Registra a pré-autorização feita no equipamento e inicia a recarga',
    description:
      'Nenhuma chamada a adquirente parte daqui: o valor já foi reservado pelo SDK ' +
      'do fabricante. Conector e provedor vêm do cadastro do terminal, nunca do corpo.',
  })
  authorization(
    @CurrentTerminal() terminal: TerminalIdentity,
    @Body() dto: TerminalAuthorizationDto,
  ) {
    return this.sessions.authorize(terminal, dto);
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Estado da recarga, para a tela atualizar sozinha' })
  session(@CurrentTerminal() terminal: TerminalIdentity, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.session(terminal, id);
  }

  @Post('sessions/:id/stop')
  @ApiOperation({
    summary: 'O motorista encerra a recarga pela maquininha',
    description:
      'A cobrança não acontece aqui: quem captura é a conciliação, depois da leitura ' +
      'final do medidor. Cobrar agora faturaria um consumo que ainda pode subir.',
  })
  stop(
    @CurrentTerminal() terminal: TerminalIdentity,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TerminalStopSessionDto,
  ) {
    return this.sessions.stop(terminal, id, dto.reason);
  }
}
