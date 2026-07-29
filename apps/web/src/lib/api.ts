/**
 * Cliente da API.
 *
 * Os tokens ficam em `sessionStorage`, nunca em `localStorage`: o token de
 * acesso vive 15 minutos e não deve sobreviver ao fechamento da aba. Cookie
 * httpOnly seria melhor e entra quando o painel ganhar renderização no servidor.
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
  role: 'SUPER_ADMIN' | 'ORG_ADMIN' | 'OPERATOR' | 'VIEWER';
  roleLabel: string;
  organizationId: string | null;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthenticatedUser;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ConnectorView {
  id: string;
  connectorNumber: number;
  connectorType: string | null;
  ratedPowerKw: number | null;
  status: string;
  statusLabel: string;
  errorCode: string | null;
  lastStatusAt: string | null;
  activeSessionId: string | null;
}

export interface ChargerView {
  id: string;
  siteId: string;
  siteName: string;
  organizationId: string;
  chargePointIdentity: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  firmwareVersion: string | null;
  protocolVersion: string;
  address: string | null;
  connectionStatus: string;
  connectionStatusLabel: string;
  operationalStatus: string;
  operationalStatusLabel: string;
  liveConnected: boolean;
  lastSeenAt: string | null;
  lastBootAt: string | null;
  lastHeartbeatAt: string | null;
  hasCredentials: boolean;
  effectivePreAuthCeilingCents: number;
  preAuthCeilingSource: string;
  ocppUrl: string;
  connectors: ConnectorView[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionView {
  id: string;
  status: string;
  statusLabel: string;
  isActive: boolean;
  chargerId: string;
  chargerName: string;
  chargePointIdentity: string;
  siteName: string;
  connectorNumber: number;
  connectorStatusLabel: string;
  ocppTransactionId: number | null;
  idTag: string | null;
  requestedAt: string;
  authorizedAt: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  meterStartWh: number | null;
  meterStopWh: number | null;
  energyWh: number | null;
  durationSeconds: number | null;
  estimatedAmountCents: number | null;
  finalAmountCents: number | null;
  ceilingAmountCents: number | null;
  stopReason: string | null;
  stopReasonLabel: string | null;
  failureReason: string | null;
  payment: {
    id: string;
    status: string;
    statusLabel: string;
    method: string;
    methodLabel: string;
    amountAuthorizedCents: number;
    amountCapturedCents: number;
  } | null;
  createdAt: string;
}

export interface TimelineStep {
  key: string;
  label: string;
  at: string | null;
  done: boolean;
}

export interface SiteView {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  timezone: string;
  status: string;
  preAuthCeilingCents: number | null;
  chargerCount: number;
  createdAt: string;
}

export interface DashboardOverview {
  chargers: {
    total: number;
    online: number;
    offline: number;
    charging: number;
    blocked: number;
    faulted: number;
  };
  today: {
    energyWh: number;
    receivedCents: number;
    sessionsStarted: number;
    sessionsCompleted: number;
  };
  activeSessions: {
    id: string;
    chargerName: string;
    connectorNumber: number;
    status: string;
    statusLabel: string;
    startedAt: string | null;
    energyWh: number | null;
  }[];
  recentSessions: {
    id: string;
    chargerName: string;
    status: string;
    statusLabel: string;
    requestedAt: string;
    energyWh: number | null;
    finalAmountCents: number | null;
  }[];
  recentFailures: {
    id: string;
    chargerName: string;
    status: string;
    statusLabel: string;
    failureReason: string | null;
    requestedAt: string;
  }[];
  ocpp: { connectedNow: number; pendingCommands: number };
  dayStartedAt: string;
}

export interface OcppMessageView {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  messageType: number;
  messageId: string;
  action: string | null;
  payload: unknown;
  responsePayload: unknown;
  errorCode: string | null;
  errorDescription: string | null;
  correlationId: string | null;
  receivedAt: string;
  respondedAt: string | null;
  processingDurationMs: number | null;
}

export interface CommandResult {
  accepted: boolean;
  message: string;
  code: string;
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

  const body: unknown = await response.json();

  if (!response.ok) {
    const error = body as ApiError;

    // Sessão expirada: limpa e deixa a página cuidar do redirecionamento.
    if (response.status === 401) clearSession();

    throw new ApiRequestError(
      // A API já devolve a frase em português; não reescrevemos aqui.
      error.message ?? 'Não foi possível completar a operação.',
      error.code ?? 'UNKNOWN',
      response.status,
      error.requestId,
    );
  }

  return body as T;
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== '') search.set(chave, String(valor));
  }
  const texto = search.toString();
  return texto ? `?${texto}` : '';
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

  overview: () => request<DashboardOverview>('/dashboard/overview'),

  sites: () => request<Paginated<SiteView>>(`/sites${query({ pageSize: 50 })}`),

  createSite: (body: Record<string, unknown>) =>
    request<SiteView>('/sites', { method: 'POST', body: JSON.stringify(body) }),

  chargers: (params: { siteId?: string } = {}) =>
    request<Paginated<ChargerView>>(`/chargers${query({ pageSize: 50, ...params })}`),

  charger: (id: string) => request<ChargerView>(`/chargers/${id}`),

  createCharger: (body: Record<string, unknown>) =>
    request<ChargerView & { credential?: string }>('/chargers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  setChargerStatus: (id: string, status: string, reason?: string) =>
    request<ChargerView>(`/chargers/${id}/operational-status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    }),

  rotateCredential: (id: string) =>
    request<{ credential: string; chargePointIdentity: string; ocppUrl: string }>(
      `/chargers/${id}/credential`,
      { method: 'POST' },
    ),

  addConnector: (chargerId: string, body: Record<string, unknown>) =>
    request<ConnectorView>(`/chargers/${chargerId}/connectors`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  chargerMessages: (
    id: string,
    params: { action?: string; direction?: string; onlyErrors?: boolean } = {},
  ) =>
    request<Paginated<OcppMessageView>>(
      `/chargers/${id}/messages${query({ pageSize: 50, ...params })}`,
    ),

  sessions: (params: { chargerId?: string; activeOnly?: boolean } = {}) =>
    request<Paginated<SessionView>>(`/sessions${query({ pageSize: 50, ...params })}`),

  session: (id: string) => request<SessionView & { timeline: TimelineStep[] }>(`/sessions/${id}`),

  sessionMeterValues: (id: string) =>
    request<{ timestamp: string; energyWh: number }[]>(`/sessions/${id}/meter-values`),

  startManual: (connectorId: string, ceilingAmountCents?: number) =>
    request<{ session: SessionView; command: CommandResult }>('/sessions/manual-start', {
      method: 'POST',
      body: JSON.stringify({ connectorId, ceilingAmountCents }),
    }),

  stopSession: (id: string) =>
    request<{ session: SessionView; command: CommandResult }>(`/sessions/${id}/stop`, {
      method: 'POST',
    }),

  cancelSession: (id: string, reason?: string) =>
    request<SessionView>(`/sessions/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};
