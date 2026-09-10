import { ArgumentsHost, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter";
import { RequestContextService } from "../src/common/request-context/request-context.service";
import { EnvironmentVariables } from "../src/config/environment.validation";

describe("HttpExceptionFilter", () => {
  it("returns standard error envelope without stack trace", () => {
    const requestContext = new RequestContextService();
    const configService = {
      get: () => "test"
    } as unknown as ConfigService<EnvironmentVariables, true>;
    const filter = new HttpExceptionFilter(requestContext, configService);
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ requestId: "req_error" })
      })
    } as ArgumentsHost;

    filter.catch(new BadRequestException({ message: ["name must be a string"] }), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: ["name must be a string"]
      },
      requestId: "req_error"
    });
  });
});
