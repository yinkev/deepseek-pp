export function unwrapRuntimeResponse<T>(response: unknown, missingMessage: string): T {
  if (isRuntimeFailure(response)) {
    throw new Error(response.error === undefined ? missingMessage : getRuntimeErrorMessage(response.error));
  }
  if (response === null || response === undefined) {
    throw new Error(missingMessage);
  }
  return response as T;
}

export function isRuntimeFailure(response: unknown): response is { ok: false; error?: unknown } {
  return Boolean(
    response &&
    typeof response === 'object' &&
    (response as { ok?: unknown }).ok === false,
  );
}

export function getRuntimeErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function getSafeRuntimeIssueMessage(error: unknown, fallback: string): string {
  const message = getRuntimeErrorMessage(error).trim();
  if (!message || message === 'undefined' || message === 'null') return fallback;
  if (
    /\b(GET|SAVE|CREATE|UPDATE|DELETE|CLEAR|SET|INSERT|WEBDAV)_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|IndexedDB|deepseek_pp_[a-z0-9_]+|Authorization|Bearer|Cookie|data:image|\[object Object\]|apiKey|openaiApiKey|geminiApiKey|OPENAI_API_KEY|GEMINI_API_KEY|DEEPSEEK_API_KEY|password|secret|token|sk-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+/i.test(message)
  ) {
    return fallback;
  }
  return message;
}
