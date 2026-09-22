import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SitesService } from './sites.service';
import { CreateSiteDto, UpdateSiteDto } from './dto/site.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireRole } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@ApiTags('Estabelecimentos')
@ApiBearerAuth()
@Controller('sites')
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  /** Contexto da requisição para a auditoria. */
  private ctx(request: Request) {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }

  @Get()
  @ApiOperation({ summary: 'Lista os estabelecimentos do usuário' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() pagination: PaginationDto) {
    return this.sites.list(user, pagination);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de um estabelecimento' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.get(user, id);
  }

  // Cadastro é ato de administração, não de operação.
  @RequireRole('ORG_ADMIN')
  @Post()
  @ApiOperation({ summary: 'Cadastra um estabelecimento' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSiteDto,
    @Req() request: Request,
  ) {
    return this.sites.create(user, dto, this.ctx(request));
  }

  @RequireRole('ORG_ADMIN')
  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um estabelecimento' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSiteDto,
    @Req() request: Request,
  ) {
    return this.sites.update(user, id, dto, this.ctx(request));
  }
}
