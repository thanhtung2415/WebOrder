import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, map } from "rxjs";
import { ApiSuccessResponse } from "../types/api-response";
import { RequestContextService } from "../request-context/request-context.service";

@Injectable()
export class ResponseEnvelopeInterceptor<TData> implements NestInterceptor<TData, ApiSuccessResponse<TData>> {
  constructor(private readonly requestContext: RequestContextService) {}

  intercept(_context: ExecutionContext, next: CallHandler<TData>): Observable<ApiSuccessResponse<TData>> {
    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
        meta: {},
        requestId: this.requestContext.getRequestId() ?? ""
      }))
    );
  }
}
