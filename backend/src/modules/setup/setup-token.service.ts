import { Injectable } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";

const HASH_PREFIX = "sha256:";

@Injectable()
export class SetupTokenService {
  hashToken(token: string): string {
    return `${HASH_PREFIX}${this.digest(token)}`;
  }

  verifyToken(token: string, storedHash: string): boolean {
    if (!storedHash.startsWith(HASH_PREFIX)) {
      return false;
    }

    const expected = Buffer.from(storedHash.slice(HASH_PREFIX.length), "hex");
    const actual = Buffer.from(this.digest(token), "hex");
    if (expected.length !== actual.length) {
      return false;
    }

    return timingSafeEqual(expected, actual);
  }

  private digest(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }
}
