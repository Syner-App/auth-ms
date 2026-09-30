import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, RpcException, Transport } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { join } from 'path';
import { AppModule } from './app.module.js';
import { envs } from './config/envs.js';
import { AUTH_PACKAGE_NAME } from './generated/proto/auth.js';
import { MongoExceptionFilter } from './common/index.js';

async function bootstrap() {
  const logger = new Logger(`Auth-Ms`);

  // gRPC only (no HTTP server)
  const app = await NestFactory.create(AppModule);

  // Global enhancers must be registered before connectMicroservice() so
  // inheritAppConfig can copy them to the microservice
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new RpcException({
          code: status.INVALID_ARGUMENT,
          message: errors
            .flatMap((error) => Object.values(error.constraints ?? {}))
            .join(', '),
        }),
    }),
  );
  app.useGlobalFilters(new MongoExceptionFilter());

  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.GRPC,
      options: {
        package: AUTH_PACKAGE_NAME,
        protoPath: join(import.meta.dirname, 'proto/auth.proto'),
        url: `0.0.0.0:${envs.port}`,
        loader: { keepCase: true, enums: String },
      },
    },
    { inheritAppConfig: true },
  );

  // init() first so lifecycle hooks (database connection) finish before any call is served
  await app.init();
  await app.startAllMicroservices();
  logger.log(`Auth MS (gRPC) listening on port ${envs.port}`);
}
await bootstrap();
