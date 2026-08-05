import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.ts";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

/**
 * Shared MariaDB pool settings for all HotCol backends.
 *
 * Important: acquireTimeout must be >= connectTimeout. If acquire is shorter,
 * cold starts (esp. Vercel → Aiven) fail with:
 *   pool timeout ... active=0 idle=0
 * even when the network and database are healthy.
 */
function resolveConnectionLimit() {
  const raw = process.env.DB_CONNECTION_LIMIT;
  const n = raw ? Number.parseInt(String(raw).trim(), 10) : NaN;
  if (Number.isFinite(n) && n >= 1 && n <= 50) return n;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return 3;
  return 5;
}

export function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Prisma");
  }

  const parsed = new URL(databaseUrl);
  const connectTimeout = 30_000;
  const adapter = new PrismaMariaDb({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
    connectionLimit: resolveConnectionLimit(),
    connectTimeout,
    acquireTimeout: connectTimeout + 5_000,
    idleTimeout: 60,
    minimumIdle: 0,
    ssl:
      parsed.searchParams.get("sslaccept") === "strict"
        ? { rejectUnauthorized: true }
        : { rejectUnauthorized: false },
  });

  return new PrismaClient({ adapter });
}
