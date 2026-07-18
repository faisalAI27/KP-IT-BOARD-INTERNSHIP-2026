export const AUTH_REQUEST_TIMEOUT_MS = 12_000;
export const API_REQUEST_TIMEOUT_MS = 20_000;
export const AUTH_REQUEST_TIMEOUT_MESSAGE =
  "We could not complete the authentication request. Please try again.";


export class RequestTimeoutError extends Error {
  constructor(message = AUTH_REQUEST_TIMEOUT_MESSAGE) {
    super(message);
    this.name = "RequestTimeoutError";
    this.code = "AUTH_REQUEST_TIMEOUT";
  }
}


export function isRequestTimeoutError(error) {
  return error?.code === "AUTH_REQUEST_TIMEOUT";
}


export async function withRequestTimeout(
  operation,
  {
    timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
    setTimeoutImpl = (...args) => globalThis.setTimeout(...args),
    clearTimeoutImpl = (timer) => globalThis.clearTimeout(timer),
    onTimeout = null,
  } = {},
) {
  if (typeof operation !== "function") {
    throw new TypeError("A request operation is required.");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Request timeout must be a positive number.");
  }

  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeoutImpl(() => {
      try {
        onTimeout?.();
      } finally {
        reject(new RequestTimeoutError());
      }
    }, timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve().then(operation), timeout]);
  } finally {
    if (timer !== null) clearTimeoutImpl(timer);
  }
}


export async function fetchWithRequestTimeout(
  fetchImpl,
  url,
  options = {},
  { timeoutMs = API_REQUEST_TIMEOUT_MS } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required.");
  }

  const controller = typeof AbortController === "function"
    ? new AbortController()
    : null;
  const requestOptions = controller
    ? { ...options, signal: controller.signal }
    : options;

  return withRequestTimeout(
    () => fetchImpl(url, requestOptions),
    {
      timeoutMs,
      onTimeout: () => controller?.abort(),
    },
  );
}
