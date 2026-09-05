export interface ParseIssue {
  line: number;
  content: string;
  message: string;
}

export interface ApiErrorPayload {
  error?: string;
  message?: string;
  issues?: ParseIssue[];
  cardNames?: string[];
}

export class ApiError extends Error {
  readonly payload: ApiErrorPayload;

  constructor(payload: ApiErrorPayload) {
    super(payload.message ?? "Une erreur inattendue est survenue.");
    this.payload = payload;
  }
}

/** Generic relative-URL JSON fetch wrapper shared by every frontend view (deck library, playtest). Never hardcodes a host — relies on same-origin/dev-proxy relative paths. */
export async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const responseText = await response.text();
  let payload: unknown = null;

  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new ApiError({
        message: `Le serveur a renvoyé une réponse illisible (${response.status}).`,
      });
    }
  }

  if (!response.ok) {
    throw new ApiError((payload ?? {}) as ApiErrorPayload);
  }

  return payload as T;
}
