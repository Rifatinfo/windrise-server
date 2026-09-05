import app from "./app";
import { envVars } from "./config";
import { startRestoreStockCron } from "./cron/restoreStock.cron";
import { startOtpCleanup } from "./app/utils/otpCleanup";
import { AdsService } from "./app/modules/ads/ads.service";
import { seedQueues } from "./app/modules/support/support.core";
import { Server } from "http";

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
    process.on("unhandledRejection", (error) => {
      console.log(
        "Unhandled Rejection is detected, we are closing our server...",
      );
      if (server) {
        server.close(() => {
          console.log(error);
          process.exit(1);
        });
      } else {
        process.exit(1);
      }
    });
  } catch (error) {
    console.error("Error during server startup:", error);
    process.exit(1);
  }
}

bootstrap();
