export type AppErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "ARCHIVED_YEAR"
  | "ARCHIVE_LOCKED_YEAR"
  | "ARCHIVE_BLOCKED_BY_PENDING_SOURCE_ITEMS"
  | "ARCHIVE_NOT_EXTERNAL_CONFIRMED"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly status = statusForCode(code),
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function statusForCode(code: AppErrorCode): number {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "ARCHIVED_YEAR":
    case "ARCHIVE_LOCKED_YEAR":
    case "ARCHIVE_BLOCKED_BY_PENDING_SOURCE_ITEMS":
    case "ARCHIVE_NOT_EXTERNAL_CONFIRMED":
    case "CONFLICT":
      return 409;
    case "VALIDATION_ERROR":
      return 400;
    default:
      return 500;
  }
}

export function notFound(message = "not found"): never {
  throw new AppError("NOT_FOUND", message);
}

export function validationError(message: string, details?: unknown): never {
  throw new AppError("VALIDATION_ERROR", message, 400, details);
}

export function forbidden(message = "forbidden"): never {
  throw new AppError("FORBIDDEN", message);
}
