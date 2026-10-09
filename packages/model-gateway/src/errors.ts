export type ModelGatewayErrorCode =
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'AUTHENTICATION_ERROR'
  | 'MODEL_NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_UNAVAILABLE'
  | 'STREAM_ABORTED'
  | 'UNKNOWN';

export class ModelGatewayError extends Error {
  public readonly code: ModelGatewayErrorCode;
  public readonly statusCode?: number | undefined;
  public readonly retryable: boolean;

  constructor(
    code: ModelGatewayErrorCode,
    message: string,
    options?: {
      statusCode?: number;
      retryable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'ModelGatewayError';
    this.code = code;
    this.statusCode = options?.statusCode;
    this.retryable = options?.retryable ?? false;
  }
}

export const sanitizeMessage = (message: string, secret?: string): string => {
  if (!secret || secret.length < 4) return message;
  return message.replaceAll(secret, '[REDACTED]');
};
