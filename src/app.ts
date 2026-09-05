import express, { Application, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";

import { rateLimiter } from "./app/middlewares/rateLimiter";
import { notFoundHandler } from "./app/middlewares/notFoundHandler";
import { errorHandler } from "./app/middlewares/errorHandler";
import routes from "./app/routes";
import path from "path";
import { envVars } from "./config";
const app: Application = express();

// Security
app.use(helmet());

// CORS
app.use(
  cors({
    origin: [envVars.FRONTEND_URL as string],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Rate limiting.
//
// Meta retries a webhook it did not get a 200 for, and every delivery arrives
// from the same handful of Facebook IPs — under the shared IP budget a busy
// Page would start getting 429s and Meta would eventually disable the
// subscription. The route does its own signature check, which is a far
// stronger gate than a request count.
app.use((req, res, next) =>
  req.path.startsWith("/api/v1/support/webhooks/") ? next() : rateLimiter(req, res, next),
);

// Body parsing.
//
// The Meta webhook is signed over the exact bytes sent, so the raw buffer has
// to survive JSON parsing. Only that path keeps it — holding a copy of every
// 10mb upload in memory to verify a signature we never check would be wasteful.
app.use(
  express.json({
    limit: "10mb",
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      if (req.originalUrl.startsWith("/api/v1/support/webhooks/")) req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

// Cookie parsing
app.use(cookieParser());
app.use(
  "/uploads",
  express.static(path.join(process.cwd(), "uploads"))
);
// Logging
if (envVars.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Health check
app.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    statusCode: 200,
    message: "Windrise Server is running",
    data: {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
  });
});

// API routes
app.use("/api/v1", routes);

// 404 handler
app.use(notFoundHandler);

// Error handler
app.use(errorHandler);

export default app;
