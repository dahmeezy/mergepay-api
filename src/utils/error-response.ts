export interface ErrorPayload {
  code: string;
  message: string;
  timestamp: string;
  requestId?: string;
  details?: unknown;
}

export function formatErrorResponse(code: string, message: string, requestId?: string, details?: unknown) {
  const payload: ErrorPayload = {
    code,
    message,
    timestamp: new Date().toISOString(),
  };
  if (requestId) payload.requestId = requestId;
  if (details !== undefined) payload.details = details;

  // Backwards-compatible top-level fields (`code`, `message`, `requestId`) are
  // included to avoid breaking existing clients/tests while introducing the
  // canonical `error` envelope.
  return { error: payload, code: payload.code, message: payload.message, requestId: payload.requestId };
}
