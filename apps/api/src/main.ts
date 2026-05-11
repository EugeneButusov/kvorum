import 'reflect-metadata';
process.env['OTEL_SERVICE_NAME'] ??= 'api';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();
  await app.listen(process.env['API_PORT'] ?? 3001);
}

bootstrap();
