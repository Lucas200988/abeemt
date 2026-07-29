/**
 * Cliente da API.
 *
 * Os tokens ficam em memória + sessionStorage, nunca em localStorage: o token
 * de acesso vive 15 minutos e não deve sobreviver ao fechamento da aba.
 * Cookie httpOnly seria melhor ainda e entra quando o painel ganhar SSR
 * autenticado (FASE 3).
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  roleLabel: string;
  organizationId: string | null;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthenticatedUser;
}

const STORAGE_KEY = 'bora.session';

export function saveSession(auth: AuthResponse): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

export function loadSession(): AuthResponse | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuthResponse;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/** Erro com a mensagem já em português, vinda da API. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = loadSession();

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const body = (await response.json()) as T | ApiError;

  if (!response.ok) {
    const error = body as ApiError;
    throw new ApiRequestError(
      // A API já devolve a frase em português; não reescrevemos no cliente.
      error.message ?? 'Não foi possível completar a operação.',
      error.code ?? 'UNKNOWN',
      response.status,
      error.requestId,
    );
  }

  return body as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<AuthenticatedUser>('/auth/me'),

  logout: (refreshToken: string) =>
    request<void>('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
};
