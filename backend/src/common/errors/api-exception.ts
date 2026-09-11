import { HttpException, HttpStatus } from "@nestjs/common";

export class ApiException extends HttpException {
  constructor(status: HttpStatus, code: string, message: string) {
    super({ code, message }, status);
  }
}

export function invalidToken(): ApiException {
  return new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_TOKEN", "Invalid authentication token");
}

export function badRequest(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.BAD_REQUEST, code, message);
}

export function forbidden(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.FORBIDDEN, code, message);
}

export function conflict(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}

export function unprocessable(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
}

export function notFound(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, code, message);
}
