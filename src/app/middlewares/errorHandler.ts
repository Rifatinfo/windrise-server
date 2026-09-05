import { Request, Response, NextFunction } from "express";
import ApiError from "../../shared/ApiError";
import httpStatus from "http-status";

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  let statusCode = err.statusCode || httpStatus.INTERNAL_SERVER_ERROR;
  let message = err.message || "Internal Server Error";

  // Prisma known request errors
  if (err.code === "P2002") {
    statusCode = httpStatus.CONFLICT;
    const field = err.meta?.target?.[0] || "field";
    message = `A record with this ${field} already exists`;
  }

  if (err.code === "P2025") {
    statusCode = httpStatus.NOT_FOUND;
    message = "Record not found";
  }

  if (err.code === "P2003") {
    statusCode = httpStatus.BAD_REQUEST;
    message = "Related record not found";
  }

  // Multer errors
  if (err.code === "LIMIT_FILE_SIZE") {
    statusCode = httpStatus.BAD_REQUEST;
    message = "File size is too large. Maximum size is 5MB";
  }

  if (err.code === "LIMIT_UNEXPECTED_FILE") {
    statusCode = httpStatus.BAD_REQUEST;
    message = "Unexpected file field";
  }

  res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};
