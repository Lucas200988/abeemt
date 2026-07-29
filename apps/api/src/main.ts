import 'reflect-metadata';
// Precisa vir antes de qualquer import que leia configuração (ver load-env.ts).
import './load-env';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import { corsOrigins, parseEnv } from '@bora/config';
import { AppModule } from './app.module';
import { OcppGateway } from './modules/ocpp/ocpp.gateway';

async function bootstrap(): Promise<void> {
  const env = parseEnv();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(PinoLogger));

  // Cabeçalhos de segurança. CSP fica desligada aqui porque a API não serve
  // HTML — quem serve o painel é o Next.js, que tem a sua própria.
  app.use(helmet({ contentSecurityPolicy: false }));

  app.enableCors({
    origin: corsOrigins(env),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.setGlobalPrefix(env.API_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      // Remove campos não declarados no DTO em vez de repassá-los adiante.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Fecha conexões do Prisma e do servidor ao receber SIGTERM.
  app.enableShutdownHooks();

  if (env.SWAGGER_ENABLED) {
    const config = new DocumentBuilder()
      .setTitle(`${env.BORA_BRAND_NAME} — API`)
      .setDescription(
        'Plataforma de monetização de carregadores OCPP.\n\n' +
          'Valores monetários sempre em centavos inteiros; energia em Wh inteiros (ADR-0005).',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();

    SwaggerModule.setup(`${env.API_PREFIX}/docs`, app, SwaggerModule.createDocument(app, config), {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // O servidor OCPP compartilha a porta HTTP: o upgrade para WebSocket acontece
  // no mesmo listener (ADR-0002 — um único processo no MVP).
  await app.listen(env.API_PORT, '0.0.0.0');

  app.get(OcppGateway).attach(app.getHttpServer());

  const logger = app.get(PinoLogger);
  logger.log(
    `${env.BORA_BRAND_NAME} — API ouvindo na porta ${env.API_PORT} (${env.NODE_ENV})` +
      (env.SWAGGER_ENABLED ? ` · docs em /${env.API_PREFIX}/docs` : ''),
  );
}

void bootstrap();
