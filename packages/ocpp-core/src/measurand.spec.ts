import { describe, expect, it } from 'vitest';
import {
  ENERGY_REGISTER,
  MeasurandError,
  energySampleToWh,
  extractEnergyWh,
  reconcileMeterReading,
} from './measurand';
import { MeterValuesRequest } from './schemas';

describe('energySampleToWh', () => {
  it('aceita Wh explícito', () => {
    expect(energySampleToWh({ value: '28350', unit: 'Wh', measurand: ENERGY_REGISTER })).toBe(
      28350,
    );
  });

  /** Padrão do OCPP 1.6 quando os campos são omitidos. */
  it('assume Energy.Active.Import.Register e Wh quando omitidos', () => {
    expect(energySampleToWh({ value: '28350' })).toBe(28350);
  });

  /** Divergência conhecida entre firmwares (risco R-11). */
  it('converte kWh para Wh', () => {
    expect(energySampleToWh({ value: '28.35', unit: 'kWh' })).toBe(28350);
    expect(energySampleToWh({ value: '1', unit: 'kWh' })).toBe(1000);
  });

  it('aceita a unidade em qualquer caixa', () => {
    expect(energySampleToWh({ value: '1', unit: 'KWH' })).toBe(1000);
    expect(energySampleToWh({ value: '100', unit: 'WH' })).toBe(100);
  });

  it('arredonda Wh fracionário de forma explícita', () => {
    // O banco guarda inteiro; arredondar aqui é visível, deixar o Prisma
    // truncar não seria (ADR-0005 e o achado da FASE 1).
    expect(energySampleToWh({ value: '28350.6' })).toBe(28351);
    expect(energySampleToWh({ value: '28350.4' })).toBe(28350);
  });

  it('ignora amostras que não são de energia acumulada', () => {
    expect(energySampleToWh({ value: '32', measurand: 'Current.Import', unit: 'A' })).toBeNull();
    expect(energySampleToWh({ value: '400', measurand: 'Voltage', unit: 'V' })).toBeNull();
    expect(energySampleToWh({ value: '85', measurand: 'SoC', unit: 'Percent' })).toBeNull();
  });

  it('recusa valor não numérico', () => {
    expect(() => energySampleToWh({ value: 'não-é-número' })).toThrow(MeasurandError);
  });

  it('recusa valor negativo', () => {
    expect(() => energySampleToWh({ value: '-100' })).toThrow(/negativa/);
  });

  it('recusa unidade desconhecida em vez de adivinhar', () => {
    // Adivinhar a unidade de uma leitura de energia é adivinhar quanto cobrar.
    expect(() => energySampleToWh({ value: '10', unit: 'MWh' })).toThrow(/não suportada/);
  });
});

describe('extractEnergyWh', () => {
  it('encontra a leitura de energia no meio de outras medidas', () => {
    const wh = extractEnergyWh([
      { value: '32.5', measurand: 'Current.Import', unit: 'A' },
      { value: '28350', measurand: ENERGY_REGISTER, unit: 'Wh' },
      { value: '400', measurand: 'Voltage', unit: 'V' },
    ]);

    expect(wh).toBe(28350);
  });

  it('devolve null quando não há leitura de energia', () => {
    expect(extractEnergyWh([{ value: '32', measurand: 'Current.Import', unit: 'A' }])).toBeNull();
  });

  /**
   * Quando o firmware manda energia por fase e também o total, as parciais têm
   * `phase` preenchida. Somar todas daria o dobro.
   */
  it('ignora leituras por fase e usa o registro acumulado', () => {
    const wh = extractEnergyWh([
      { value: '9000', measurand: ENERGY_REGISTER, unit: 'Wh', phase: 'L1' },
      { value: '9500', measurand: ENERGY_REGISTER, unit: 'Wh', phase: 'L2' },
      { value: '9850', measurand: ENERGY_REGISTER, unit: 'Wh', phase: 'L3' },
      { value: '28350', measurand: ENERGY_REGISTER, unit: 'Wh' },
    ]);

    expect(wh).toBe(28350);
  });

  it('usa a maior quando há mais de um registro acumulado sem fase', () => {
    const wh = extractEnergyWh([
      { value: '28000', measurand: ENERGY_REGISTER },
      { value: '28350', measurand: ENERGY_REGISTER },
    ]);

    expect(wh).toBe(28350);
  });

  it('devolve null para lista vazia', () => {
    expect(extractEnergyWh([])).toBeNull();
  });
});

describe('reconcileMeterReading — MeterValues fora de ordem', () => {
  it('aceita a primeira leitura', () => {
    expect(reconcileMeterReading(null, 1000)).toEqual({ valor: 1000, foraDeOrdem: false });
  });

  it('aceita leitura crescente', () => {
    expect(reconcileMeterReading(1000, 2000)).toEqual({ valor: 2000, foraDeOrdem: false });
  });

  /**
   * Exigência de teste da seção 16 do briefing. Se aceitássemos a última
   * leitura recebida, uma mensagem atrasada faria a energia da sessão — e o
   * valor a cobrar — diminuir.
   */
  it('descarta leitura atrasada e sinaliza', () => {
    expect(reconcileMeterReading(2000, 1500)).toEqual({ valor: 2000, foraDeOrdem: true });
  });

  it('trata leitura repetida como fora de ordem, sem alterar o valor', () => {
    expect(reconcileMeterReading(2000, 2000)).toEqual({ valor: 2000, foraDeOrdem: true });
  });

  it('a leitura acumulada nunca diminui, em qualquer ordem de chegada', () => {
    const chegadaEmbaralhada = [1000, 5000, 2000, 4000, 3000, 6000];
    let acumulado: number | null = null;
    const historico: number[] = [];

    for (const leitura of chegadaEmbaralhada) {
      acumulado = reconcileMeterReading(acumulado, leitura).valor;
      historico.push(acumulado);
    }

    expect(acumulado).toBe(6000);
    // Monotônico: cada valor é maior ou igual ao anterior.
    for (let i = 1; i < historico.length; i += 1) {
      expect(historico[i]).toBeGreaterThanOrEqual(historico[i - 1]);
    }
  });
});

describe('esquema de MeterValues', () => {
  it('interpreta um MeterValues realista do WEMOB', () => {
    const payload = {
      connectorId: 1,
      transactionId: 42,
      meterValue: [
        {
          timestamp: '2026-07-29T21:00:00Z',
          sampledValue: [
            {
              value: '28350',
              context: 'Sample.Periodic',
              measurand: ENERGY_REGISTER,
              unit: 'Wh',
            },
            { value: '32.5', measurand: 'Current.Import', unit: 'A' },
          ],
        },
      ],
    };

    const parsed = MeterValuesRequest.parse(payload);

    expect(parsed.meterValue[0].timestamp).toBeInstanceOf(Date);
    expect(extractEnergyWh(parsed.meterValue[0].sampledValue)).toBe(28350);
  });

  /** Firmwares que mandam timestamp sem timezone não devem ser recusados. */
  it('aceita timestamp sem timezone, interpretando como UTC', () => {
    const parsed = MeterValuesRequest.parse({
      connectorId: 1,
      meterValue: [{ timestamp: '2026-07-29T21:00:00', sampledValue: [{ value: '100' }] }],
    });

    expect(parsed.meterValue[0].timestamp.toISOString()).toBe('2026-07-29T21:00:00.000Z');
  });

  it('recusa timestamp sem sentido', () => {
    expect(() =>
      MeterValuesRequest.parse({
        connectorId: 1,
        meterValue: [{ timestamp: 'ontem', sampledValue: [{ value: '100' }] }],
      }),
    ).toThrow();
  });
});
