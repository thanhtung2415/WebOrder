import { Injectable, NestMiddleware } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { EnvironmentVariables } from "../../config/environment.validation";
import { RequestContextService } from "../request-context/request-context.service";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly requestContext: RequestContextService
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const headerName = this.configService.get("REQUEST_ID_HEADER", { infer: true });
    const incomingRequestId = request.header(headerName);
    const requestId = incomingRequestId && incomingRequestId.trim().length > 0 ? incomingRequestId.trim() : randomUUID();

    request.requestId = requestId;
    response.setHeader(headerName, requestId);

    this.requestContext.run(requestId, next);
  }
}
