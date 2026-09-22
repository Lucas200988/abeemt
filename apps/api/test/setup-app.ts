import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

/**
 * Sobe a aplicação com a MESMA configuração do main.ts.
 *
 * Se o teste montasse a app com pipes ou filtros diferentes, estaria validando
 * um sistema que não existe em produção — e as garantias de validação e de
 * formato de erro não estariam realmente cobertas.
 */
export async function createTestApp(): Promise<INestApplication> {
  // Importado aqui dentro para que o .env de teste já esteja carregado.
  const { AppModule } = await import('../src/app.module');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication({ logger: false });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.init();
  return app;
}
