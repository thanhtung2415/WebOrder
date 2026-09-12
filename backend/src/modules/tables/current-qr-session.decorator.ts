import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { Request } from "express";
import { QrSessionContext } from "./table.types";

export const CurrentQrSession = createParamDecorator((_data: unknown, ctx: ExecutionContext): QrSessionContext | undefined => {
  const request = ctx.switchToHttp().getRequest<Request>();
  return request.qrSessionContext;
});
