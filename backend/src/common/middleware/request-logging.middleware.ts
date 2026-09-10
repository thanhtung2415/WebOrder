import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { StructuredLoggerService } from "../logging/structured-logger.service";

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(private readonly logger: StructuredLoggerService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();

    response.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.logger.logHttp({
        requestId: request.requestId ?? "",
        method: request.method,
        route: request.originalUrl,
        status: response.statusCode,
        durationMs: Math.round(durationMs * 100) / 100
      });
    });

    next();
  }
}
