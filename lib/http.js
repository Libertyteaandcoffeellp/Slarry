// Small helpers shared by every /api function (Web-standard Request/Response handlers).

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

// Wraps a handler so thrown HttpErrors become JSON responses and anything else becomes a 500.
export function handle(fn) {
  return async request => {
    try {
      return await fn(request);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, ...(err.extra || {}) }, err.status);
      console.error(err);
      return json({ error: "Something went wrong on the server." }, 500);
    }
  };
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
}

export const str = (v, max = 500) => (v == null ? "" : String(v)).trim().slice(0, max);
