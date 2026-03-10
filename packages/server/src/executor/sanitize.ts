import { KondError, ErrorCode } from "@gigai/shared";

const MAX_ARG_LENGTH = 64 * 1024; // 64KB

export function sanitizeArgs(args: string[]): string[] {
  return args.map((arg, i) => {
    if (arg.includes("\0")) {
      throw new KondError(
        ErrorCode.VALIDATION_ERROR,
        `Argument ${i} contains null byte`,
      );
    }
    if (arg.length > MAX_ARG_LENGTH) {
      throw new KondError(
        ErrorCode.VALIDATION_ERROR,
        `Argument ${i} exceeds maximum length of ${MAX_ARG_LENGTH}`,
      );
    }
    return arg;
  });
}
