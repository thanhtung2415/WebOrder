import { PrismaService } from "../src/database/prisma.service";

const shouldRunDatabaseTests = process.env.RUN_DB_TESTS === "true";

describe("Prisma connectivity", () => {
  it("connects to PostgreSQL when database tests are enabled", async () => {
    if (!shouldRunDatabaseTests) {
      return;
    }

    const prisma = new PrismaService();
    await expect(prisma.ping()).resolves.toBe(true);
    await prisma.$disconnect();
  });
});
