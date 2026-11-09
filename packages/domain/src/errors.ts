/** Error with a stable machine-readable code. Safe to show `message` to users. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function fail(code: string, message: string, details?: unknown): never {
  throw new DomainError(code, message, details);
}
