import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { envVars } from "../config";

// The connection string lives in .env only. Hardcoding it here once meant the
// app kept talking to an old database after DATABASE_URL was pointed at a new
// one, while the Prisma CLI migrated the new one — the two silently diverged.
const adapter = new PrismaPg({
  connectionString: envVars.DATABASE_URL,
  max: 20,
  connectionTimeoutMillis: 15000,
});

const prisma = new PrismaClient({ adapter });

export default prisma;
