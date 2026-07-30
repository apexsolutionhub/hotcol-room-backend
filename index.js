import express from "express";
import { ApolloServer } from "apollo-server-express";
import cors from "cors";
import "dotenv/config";
import { typeDefs } from "./typeDefs.js";
import { resolvers } from "./resolvers.js";
import { authenticateRequest } from "./lib/auth.js";
import { prisma } from "./lib/prisma.js";

function assertPrismaRoomModels() {
  if (!prisma.user?.findMany || !prisma.lodging_room?.findMany) {
    throw new Error(
      "[HotCol Room API] Prisma client is out of date — expected shared HotCol models are missing. Run `npm run prisma:generate` in BackEnd.",
    );
  }
}

assertPrismaRoomModels();

const app = express();
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: ({ req }) => {
    const forwarded = req.headers["x-forwarded-for"];
    const clientIp = Array.isArray(forwarded)
      ? String(forwarded[0] || "")
      : String(forwarded || "")
          .split(",")[0]
          .trim() ||
        req.socket?.remoteAddress ||
        "unknown";
    return {
      user: authenticateRequest(req),
      prisma,
      req,
      clientIp,
    };
  },
});

await server.start();
server.applyMiddleware({
  app,
  path: "/graphql",
  bodyParserConfig: { limit: "2mb" },
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "OK",
    service: "HotCol Room GraphQL API",
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (_req, res) => {
  res.status(200).json({
    status: "OK",
    service: "HotCol Room GraphQL API",
    graphql: "/graphql",
    health: "/health",
  });
});

/** Required for Vercel serverless — do not call app.listen() there. */
export default app;

if (!process.env.VERCEL) {
  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    console.log(`Room API ready at http://localhost:${port}/graphql`);
    console.log("Guest portal: guestLogin / guestPlaceOrder (OTP until checkout)");
    console.log("Prisma: run `npm run prisma:generate` after schema changes");
  });
}
