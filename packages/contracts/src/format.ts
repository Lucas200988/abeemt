/**
 * Formatação para o padrão brasileiro (briefing seção 14).
 *
 * Datas em dd/mm/aaaa, moeda em real, energia em kWh, potência em kW e duração
 * em horas/minutos/segundos.
 */

const FUSO_PADRAO = 'America/Cuiaba';

export function formatDateTime(
  value: Date | string | null | undefined,
  timeZone = FUSO_PADRAO,
): string {
  if (!value) return '—';
  const data = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(data.getTime())) return '—';

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone,
  }).format(data);
}

export function formatDate(
  value: Date | string | null | undefined,
  timeZone = FUSO_PADRAO,
): string {
  if (!value) return '—';
  const data = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(data.getTime())) return '—';

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone,
  }).format(data);
}

/**
 * Tempo decorrido em linguagem natural.
 *
 * Serve para "última comunicação há 3 minutos", que diz mais ao operador do que
 * um timestamp absoluto quando o assunto é "este carregador está vivo?".
 */
export function formatRelative(
  value: Date | string | null | undefined,
  agora: Date = new Date(),
): string {
  if (!value) return 'nunca';
  const data = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(data.getTime())) return '—';

  const segundos = Math.floor((agora.getTime() - data.getTime()) / 1000);

  if (segundos < 0) return 'agora';
  if (segundos < 10) return 'agora';
  if (segundos < 60) return `há ${segundos} s`;

  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;

  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
}

/** Duração em h/min/s, como pede a seção 14. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 0) return '—';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min ${String(s).padStart(2, '0')}s`;
  if (m > 0) return `${m}min ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** Potência em kW. */
export function formatKw(kw: number | string | null | undefined): string {
  if (kw === null || kw === undefined) return '—';
  const n = typeof kw === 'string' ? Number(kw) : kw;
  if (!Number.isFinite(n)) return '—';

  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(n)} kW`;
}
