class ApiError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string | undefined, stack = "") {
    super(message);
    this.statusCode = statusCode;
    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export default ApiError;

export const createError = (statusCode: number, message: string) =>
  new ApiError(statusCode, message);

export const BadRequestError = (message = "Bad Request") =>
  createError(400, message);

export const UnauthorizedError = (message = "Unauthorized") =>
  createError(401, message);

export const ForbiddenError = (message = "Forbidden") =>
  createError(403, message);

export const NotFoundError = (message = "Not Found") =>
  createError(404, message);

export const ConflictError = (message = "Conflict") =>
  createError(409, message);

export const InternalError = (message = "Internal Server Error") =>
  createError(500, message);
