export enum ErrorCode {
  PAIRING_EXPIRED = "PAIRING_EXPIRED",
  PAIRING_INVALID = "PAIRING_INVALID",
  PAIRING_USED = "PAIRING_USED",
  TOKEN_INVALID = "TOKEN_INVALID",
  TOKEN_DECRYPT_FAILED = "TOKEN_DECRYPT_FAILED",
  ORG_MISMATCH = "ORG_MISMATCH",
  SESSION_EXPIRED = "SESSION_EXPIRED",
  SESSION_INVALID = "SESSION_INVALID",
  AUTH_REQUIRED = "AUTH_REQUIRED",
  TOOL_NOT_FOUND = "TOOL_NOT_FOUND",
  EXEC_TIMEOUT = "EXEC_TIMEOUT",
  EXEC_FAILED = "EXEC_FAILED",
  HTTPS_REQUIRED = "HTTPS_REQUIRED",
  RATE_LIMITED = "RATE_LIMITED",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  MCP_ERROR = "MCP_ERROR",
  MCP_NOT_CONNECTED = "MCP_NOT_CONNECTED",
  TRANSFER_NOT_FOUND = "TRANSFER_NOT_FOUND",
  TRANSFER_EXPIRED = "TRANSFER_EXPIRED",
  PATH_NOT_ALLOWED = "PATH_NOT_ALLOWED",
  COMMAND_NOT_ALLOWED = "COMMAND_NOT_ALLOWED",
}

const STATUS_CODES: Record<ErrorCode, number> = {
  [ErrorCode.PAIRING_EXPIRED]: 410,
  [ErrorCode.PAIRING_INVALID]: 400,
  [ErrorCode.PAIRING_USED]: 409,
  [ErrorCode.TOKEN_INVALID]: 401,
  [ErrorCode.TOKEN_DECRYPT_FAILED]: 401,
  [ErrorCode.ORG_MISMATCH]: 403,
  [ErrorCode.SESSION_EXPIRED]: 401,
  [ErrorCode.SESSION_INVALID]: 401,
  [ErrorCode.AUTH_REQUIRED]: 401,
  [ErrorCode.TOOL_NOT_FOUND]: 404,
  [ErrorCode.EXEC_TIMEOUT]: 408,
  [ErrorCode.EXEC_FAILED]: 500,
  [ErrorCode.HTTPS_REQUIRED]: 403,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.MCP_ERROR]: 502,
  [ErrorCode.MCP_NOT_CONNECTED]: 503,
  [ErrorCode.TRANSFER_NOT_FOUND]: 404,
  [ErrorCode.TRANSFER_EXPIRED]: 410,
  [ErrorCode.PATH_NOT_ALLOWED]: 403,
  [ErrorCode.COMMAND_NOT_ALLOWED]: 403,
};

export class GigaiError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "GigaiError";
    this.code = code;
    this.statusCode = STATUS_CODES[code];
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined && { details: this.details }),
      },
    };
  }
}
