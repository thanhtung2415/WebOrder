import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { Request } from "express";
import { AuthContext } from "./auth-context";

export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContext => {
  const request = context.switchToHttp().getRequest<Request>();
  if (!request.authContext) {
    throw new Error("Auth context is unavailable");
  }
  return request.authContext;
});
