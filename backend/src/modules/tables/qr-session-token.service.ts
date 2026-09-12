import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SessionStatus } from "@prisma/client";
import { JwtPayload, sign, verify } from "jsonwebtoken";
import { ApiException, conflict } from "../../common/errors/api-exception";
import { EnvironmentVariables } from "../../config/environment.validation";
import { PrismaService } from "../../database/prisma.service";
import { QrSessionContext } from "./table.types";

interface QrSessionJwtPayload extends JwtPayload {
  typ: "qr-session";
  branchId: string;
  tableId: string;
  tableSessionId: string;
}

@Injectable()
export class QrSessionTokenService {
  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly prisma: PrismaService
  ) {}

  sign(context: QrSessionContext): string {
    const secret = this.configService.get("QR_SESSION_SECRET", { infer: true });
    return sign(
      {
        typ: "qr-session",
        branchId: context.branchId,
        tableId: context.tableId,
        tableSessionId: context.tableSessionId
      },
      secret,
      { expiresIn: "12h" }
    );
  }

  async verifyActive(token: string): Promise<QrSessionContext> {
    let payload: string | JwtPayload;
    try {
      payload = verify(token, this.configService.get("QR_SESSION_SECRET", { infer: true }));
    } catch {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_QR_SESSION", "Invalid QR session token");
    }

    if (typeof payload === "string" || !this.isQrSessionPayload(payload)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_QR_SESSION", "Invalid QR session token");
    }

    const session = await this.prisma.tableSession.findFirst({
      where: {
        id: payload.tableSessionId,
        branchId: payload.branchId,
        tableId: payload.tableId
      }
    });
    if (!session) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_QR_SESSION", "Invalid QR session token");
    }
    if (session.status === SessionStatus.CLOSED || session.closedAt) {
      throw conflict("SESSION_CLOSED", "Table session is closed");
    }
    return {
      branchId: payload.branchId,
      tableId: payload.tableId,
      tableSessionId: payload.tableSessionId
    };
  }

  private isQrSessionPayload(payload: JwtPayload): payload is QrSessionJwtPayload {
    return (
      payload.typ === "qr-session" &&
      typeof payload.branchId === "string" &&
      typeof payload.tableId === "string" &&
      typeof payload.tableSessionId === "string"
    );
  }
}
