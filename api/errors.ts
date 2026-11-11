export class AppError extends Error {
  operationId?: string;
  resourceId?: string;
  constructor(
    public status: number,
    public code: string,
    public fieldErrors?: Record<string, string>,
    public retryAfter?: number,
  ) {
    super(code);
  }
}
export function requireCondition(
  condition: unknown,
  status: number,
  code: string,
): asserts condition {
  if (!condition) throw new AppError(status, code);
}
