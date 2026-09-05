import type { Application } from "express";
import type { IncomingMessage, ServerResponse, Server } from "http";

/**
 * Entry point for both the long-running local server and the Vercel
 * serverless function.
 *
 * Every import below is deliberately lazy. A static `import app from "./app"`
 * pulls in the whole route tree — and with it `./config`, which throws on the
 * first missing environment variable, and `./shared/prisma`, which builds the
 * client at module scope. On Vercel a throw at module load never reaches
 * Express, so the platform answers FUNCTION_INVOCATION_FAILED with an empty
 * body and the reason is only visible in the runtime logs. Loading inside a
 * try/catch keeps the reason in the response instead.
 */

let app: Application | undefined;
let startupError: Error | undefined;

try {
  app = require("./app").default as Application;
} catch (error) {
  startupError = error as Error;
  console.error("[startup] the application failed to initialise:", error);
}

/** What Vercel invokes. Express apps are themselves `(req, res)` handlers. */
const handler = (req: IncomingMessage, res: ServerResponse) => {
  if (app) {
    (app as unknown as (rq: IncomingMessage, rs: ServerResponse) => void)(req, res);
    return;
  }

  res.statusCode = 500;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      success: false,
      message: "Server failed to start.",
      // The message only ever names the missing setting, never its value.
      error: startupError?.message ?? "Unknown startup error",
    }),
  );
};

export default handler;

async function bootstrap() {
  const { envVars } = require("./config") as typeof import("./config");
  const { startRestoreStockCron } =
    require("./cron/restoreStock.cron") as typeof import("./cron/restoreStock.cron");
  const { startOtpCleanup } =
    require("./app/utils/otpCleanup") as typeof import("./app/utils/otpCleanup");
  const { AdsService } =
    require("./app/modules/ads/ads.service") as typeof import("./app/modules/ads/ads.service");
  const { seedQueues } =
    require("./app/modules/support/support.core") as typeof import("./app/modules/support/support.core");

  let server: Server;

  try {
    server = (app as Application).listen(envVars.PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${envVars.PORT}`);
      startRestoreStockCron();
      startOtpCleanup();
      // Ensures the five built-in ad slots exist before the Placements board
      // is ever opened.
      void AdsService.seedSystemPlacements();
      // Same idea for support: a conversation arriving before an admin has
      // opened the dashboard still needs a queue to sit in.
      void seedQueues();
    });

    const exitHandler = () => {
      if (server) {
        server.close(() => {
          console.log("Server closed gracefully.");
          process.exit(1);
        });
      } else {
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => {
      console.log("SIGTERM received. Shutting down gracefully...");
      server.close(() => console.log("Process terminated."));
    });

    process.on("SIGINT", () => {
      console.log("SIGINT received. Shutting down gracefully...");
      server.close(() => console.log("Process terminated."));
    });

    process.on("unhandledRejection", (reason: unknown, promise) => {
      console.error("Unhandled Rejection at:", promise, "reason:", reason);
      void exitHandler;
    });

    process.on("uncaughtException", (error) => {
      console.error("Uncaught Exception:", error);
      process.exit(1);
    });
  } catch (error) {
    console.error("Error during server startup:", error);
    process.exit(1);
  }
}

// Serverless functions must not bind a port; only the local process starts one.
if (!process.env.VERCEL) {
  if (startupError) throw startupError;
  bootstrap();
}
