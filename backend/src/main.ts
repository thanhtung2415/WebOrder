import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { json, urlencoded } from "express";
import helmet from "helmet";
import "reflect-metadata";
import { AppModule } from "./app.module";
import { EnvironmentVariables } from "./config/environment.validation";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { ResponseEnvelopeInterceptor } from "./common/interceptors/response-envelope.interceptor";
import { RequestContextService } from "./common/request-context/request-context.service";
import { StructuredLoggerService } from "./common/logging/structured-logger.service";

export function configureApp(app: INestApplication): void {
  const configService = app.get(ConfigService<EnvironmentVariables, true>);
  const requestContext = app.get(RequestContextService);

  app.useLogger(app.get(StructuredLoggerService));
  app.use(helmet());
  app.use(json({ limit: "1mb" }));
  app.use(urlencoded({ extended: true, limit: "1mb" }));
  app.enableCors({
    credentials: true,
    origin: configService.get("CORS_ORIGINS", { infer: true })
  });
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );
  app.useGlobalFilters(new HttpExceptionFilter(requestContext, configService));
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor(requestContext));

  const documentConfig = new DocumentBuilder()
    .setTitle("Web Order API")
    .setDescription("Phase 0 foundation API documentation.")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, documentConfig);
  SwaggerModule.setup("api/docs", app, document);
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  app.enableShutdownHooks();

  const configService = app.get(ConfigService<EnvironmentVariables, true>);
  await app.listen(configService.get("APP_PORT", { infer: true }));
}

if (require.main === module) {
  void bootstrap();
}
