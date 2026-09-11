import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { Request } from "express";
import { BranchContext } from "./branch-context";

export const CurrentBranch = createParamDecorator((_data: unknown, ctx: ExecutionContext): BranchContext => {
  const request = ctx.switchToHttp().getRequest<Request>();
  if (!request.branchContext) {
    throw new Error("Branch context is unavailable");
  }
  return request.branchContext;
});
