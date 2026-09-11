import { SetupTokenService } from "../src/modules/setup/setup-token.service";

describe("SetupTokenService", () => {
  const service = new SetupTokenService();

  it("verifies a token with a stored hash", () => {
    const hash = service.hashToken("correct-token");

    expect(hash).not.toContain("correct-token");
    expect(service.verifyToken("correct-token", hash)).toBe(true);
    expect(service.verifyToken("wrong-token", hash)).toBe(false);
  });
});
