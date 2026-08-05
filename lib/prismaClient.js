import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.ts";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

/**
 * Shared MariaDB pool settings for all HotCol backends.
 * Aiven plans have a low connection cap; uncapped pools + serverless
 * concurrency caused "Too many connections" and multi-second login waits.
 */
function resolveConnectionLimit() {
  const raw = process.env.DB_CONNECTION_LIMIT;
  const n = raw ? Number.parseInt(String(raw).trim(), 10) : NaN;
  if (Number.isFinite(n) && n >= 1 && n <= 50) return n;
  // Serverless: keep each instance tiny. Local/dev: small fixed pool.
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return 2;
  return 5;
}

export function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Prisma");
  }

  const parsed = new URL(databaseUrl);
  const adapter = new PrismaMariaDb({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
    connectionLimit: resolveConnectionLimit(),
    // Default mariadb connectTimeout is 1s; remote Aiven often needs longer.
    connectTimeout: 30_000,
    // Fail fast instead of hanging login while waiting on an exhausted pool.
    acquireTimeout: 15_000,
    // Release idle sockets sooner so Aiven slots free up across deploys/scripts.
    idleTimeout: 60,
    minimumIdle: 0,
    ssl:
      parsed.searchParams.get("sslaccept") === "strict"
        ? { rejectUnauthorized: true }
        : { rejectUnauthorized: false },
  });

  return new PrismaClient({ adapter });
}
