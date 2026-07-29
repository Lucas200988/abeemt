#!/usr/bin/env node
/**
 * Simulador OCPP por linha de comando.
 *
 *   pnpm --filter @bora/ocpp-simulator start -- --identity SIM-001
 *
 * Sobe um carregador simulado que conecta, se apresenta, manda heartbeat e
 * responde aos comandos do servidor. Serve para exercitar o painel sem
 * equipamento físico.
 */
import { OcppSimulator, type SimulatorOptions } from './simulator';

interface CliArgs extends SimulatorOptions {
  plugIn: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const atual = argv[i];
    if (!atual.startsWith('--')) continue;

    const chave = atual.slice(2);
    const proximo = argv[i + 1];

    // Sinalizadores sem valor viram "true".
    if (proximo === undefined || proximo.startsWith('--')) {
      args.set(chave, 'true');
    } else {
      args.set(chave, proximo);
      i += 1;
    }
  }

  const numero = (chave: string, padrao: number) => {
    const valor = args.get(chave);
    if (valor === undefined) return padrao;
    const n = Number(valor);
    if (!Number.isFinite(n)) {
      throw new Error(`--${chave} precisa ser numérico (recebido: ${valor})`);
    }
    return n;
  };

  const unidade = args.get('energy-unit') ?? 'Wh';
  if (unidade !== 'Wh' && unidade !== 'kWh') {
    throw new Error('--energy-unit aceita apenas Wh ou kWh');
  }

  return {
    url: args.get('url') ?? 'ws://localhost:3001/ocpp',
    chargePointIdentity: args.get('identity') ?? 'SIM-001',
    password: args.get('password'),
    connectors: numero('connectors', 2),
    powerKw: numero('power', 30),
    heartbeatIntervalMs: numero('heartbeat', 30) * 1000,
    meterIntervalMs: numero('meter-interval', 5) * 1000,
    initialMeterWh: numero('initial-meter', 1_000_000),
    energyUnit: unidade,
    autoReconnect: args.get('no-reconnect') !== 'true',
    rejectRemoteStart: args.get('reject-start') === 'true',
    rejectRemoteStop: args.get('reject-stop') === 'true',
    neverStartTransaction: args.get('never-start') === 'true',
    sendOutOfOrderMeterValues: args.get('out-of-order') === 'true',
    plugIn: args.get('plug-in') === 'true',
  };
}

function ajuda(): void {
  console.log(`
Simulador OCPP 1.6J — Borá Carregar

  --url <url>              endereço do servidor (padrão: ws://localhost:3001/ocpp)
  --identity <id>          Charge Point Identity (padrão: SIM-001)
  --password <senha>       credencial para Basic Auth, se o carregador tiver uma
  --connectors <n>         número de conectores (padrão: 2)
  --power <kW>             potência simulada (padrão: 30)
  --heartbeat <s>          intervalo de heartbeat (padrão: 30)
  --meter-interval <s>     intervalo entre MeterValues (padrão: 5)
  --initial-meter <Wh>     leitura inicial do medidor (padrão: 1000000)
  --energy-unit <Wh|kWh>   unidade das leituras (padrão: Wh)
  --plug-in                já conecta o "veículo" ao subir

  Simulação de falhas:
  --reject-start           recusa RemoteStartTransaction
  --reject-stop            recusa RemoteStopTransaction
  --never-start            aceita o comando mas não inicia a transação
  --out-of-order           envia leitura de medidor fora de ordem
  --no-reconnect           não reconecta ao cair
`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    ajuda();
    return;
  }

  const { plugIn, ...opcoes } = parseArgs(process.argv.slice(2));
  const sim = new OcppSimulator(opcoes);

  sim.on('connected', () => console.log(`[sim] conectado como ${opcoes.chargePointIdentity}`));
  sim.on('disconnected', ({ code, reason }) =>
    console.log(`[sim] desconectado (${code}) ${reason}`),
  );
  sim.on('reconnected', () => console.log('[sim] reconectado'));
  sim.on('command', ({ action }) => console.log(`[sim] comando recebido: ${action}`));
  sim.on('socket-error', (error: Error) => console.error(`[sim] erro de socket: ${error.message}`));

  await sim.connect();

  const boot = await sim.bootNotification();
  console.log(`[sim] BootNotification → ${String(boot.status)}`);

  const total = opcoes.connectors ?? 2;
  for (let i = 1; i <= total; i += 1) {
    await sim.statusNotification(i, 'Available');
  }
  console.log(`[sim] ${total} conector(es) anunciado(s) como Available`);

  if (plugIn) {
    await sim.plugIn(1);
    console.log('[sim] veículo conectado ao conector 1');
  }

  console.log('[sim] aguardando comandos. Ctrl+C para encerrar.');

  const encerrar = async () => {
    console.log('\n[sim] encerrando…');
    await sim.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void encerrar());
  process.on('SIGTERM', () => void encerrar());
}

main().catch((error: unknown) => {
  console.error('[sim] falha:', error instanceof Error ? error.message : error);
  process.exit(1);
});
