import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import { EnvironmentVariables } from "../../config/environment.validation";
import { RequestContextService } from "../request-context/request-context.service";
import { ApiErrorResponse } from "../types/api-response";

type ErrorResponsePayload = string | { message?: string | string[]; error?: string; code?: string; details?: unknown };

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly configService: ConfigService<EnvironmentVariables, true>
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : undefined;
    const payload = this.toErrorPayload(status, exceptionResponse);
    const isProduction = this.configService.get("NODE_ENV", { infer: true }) === "production";
    const requestId = this.requestContext.getRequestId() ?? request.requestId ?? "";
    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: payload.code,
        message: payload.message,
        ...(!isProduction && payload.details !== undefined ? { details: payload.details } : {})
      },
      requestId
    };

    response.status(status).json(body);
  }

  private toErrorPayload(status: number, response: unknown): { code: string; message: string; details?: unknown } {
    if (typeof response === "object" && response !== null) {
      const typed = response as ErrorResponsePayload;
      if (typeof typed !== "string") {
        const message = Array.isArray(typed.message) ? "Validation failed" : typed.message ?? typed.error ?? "Request failed";
        return {
          code: typed.code ?? this.defaultCodeForStatus(status),
          message,
          details: Array.isArray(typed.message) ? typed.message : typed.details
        };
      }
    }

    return {
      code: this.defaultCodeForStatus(status),
      message: typeof response === "string" ? response : "Request failed"
    };
  }

  private defaultCodeForStatus(status: number): string {
    if (status === HttpStatus.BAD_REQUEST) {
      return "VALIDATION_ERROR";
    }
    if (status === HttpStatus.UNAUTHORIZED) {
      return "INVALID_TOKEN";
    }
    if (status === HttpStatus.FORBIDDEN) {
      return "FORBIDDEN";
    }
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      return "RATE_LIMITED";
    }
    return "INTERNAL_ERROR";
  }
}
