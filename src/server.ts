import app from "./app";
import { envVars } from "./config";
import { startRestoreStockCron } from "./cron/restoreStock.cron";
import { startOtpCleanup } from "./app/utils/otpCleanup";
import { AdsService } from "./app/modules/ads/ads.service";
import { seedQueues } from "./app/modules/support/support.core";
import { Server } from "http";

const PORT = envVars.PORT;

// const server = app.listen(PORT, () => {
//   console.log(`Windrise Server is running on port ${PORT}`);
//   console.log(`Environment: ${envVars.NODE_ENV}`);
//   console.log(`Health check: http://localhost:${PORT}`);
//   console.log(`API base: http://localhost:${PORT}/api/v1`);
// });

async function bootstrap() {
  // This variable will hold our server instance
  let server: Server;

  try {
    // Start the server
    server = app.listen(envVars.PORT, () => {
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

    // Function to gracefully shut down the server
    const exitHandler = () => {
      if (server) {
        server.close(() => {
          console.log("Server closed gracefully.");
          process.exit(1); // Exit with a failure code
        });
      } else {
        process.exit(1);
      }
    };

    // Handle unhandled promise rejections
    // Graceful shutdown
    process.on("SIGTERM", () => {
      console.log("SIGTERM received. Shutting down gracefully...");
      server.close(() => {
        console.log("Process terminated.");
      });
    });

    process.on("SIGINT", () => {
      console.log("SIGINT received. Shutting down gracefully...");
      server.close(() => {
        console.log("Process terminated.");
      });
    });

    // Unhandled rejection
    process.on("unhandledRejection", (reason: any, promise) => {
      console.error("Unhandled Rejection at:", promise, "reason:", reason);
    });

    // Uncaught exception
    process.on("uncaughtException", (error) => {
      console.error("Uncaught Exception:", error);
      process.exit(1);
    });
  } catch (error) {
    console.error("Error during server startup:", error);
    process.exit(1);
  }
}


bootstrap();