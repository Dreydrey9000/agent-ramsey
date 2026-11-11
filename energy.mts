import { optional, readNative, type NativeReader } from './native.mts';

const FIELDS = ['Voltage', 'Amperage', 'InstantAmperage', 'ExternalConnected', 'IsCharging', 'CurrentCapacity', 'CycleCount'] as const;
const THERMAL_SCRIPT = "ObjC.import('Foundation'); JSON.stringify({thermalState:Number($.NSProcessInfo.processInfo.thermalState),lowPowerMode:Boolean($.NSProcessInfo.processInfo.isLowPowerModeEnabled)})";

export function thermalName(value: unknown): string | null {
  return typeof value === 'number' ? ['nominal', 'fair', 'serious', 'critical'][value] ?? null : null;
}

export function parseBattery(values: Record<string, string | null>) {
  function number(name: string): number | null {
    const raw = values[name];
    if (!raw || !/^-?\d+$/.test(raw)) return null;
    let integer = BigInt(raw);
    if (integer >= 2n ** 63n && integer < 2n ** 64n) integer -= 2n ** 64n;
    const value = Number(integer);
    return Number.isSafeInteger(value) ? value : null;
  }
  const rawVoltage = number('Voltage');
  const rawCurrent = number('InstantAmperage') ?? number('Amperage');
  const voltageMillivolts = rawVoltage !== null && rawVoltage > 0 && rawVoltage <= 30000 ? rawVoltage : null;
  const currentMilliamps = rawCurrent !== null && Math.abs(rawCurrent) <= 30000 ? rawCurrent : null;
  const externalConnected = values.ExternalConnected === 'true' ? true : values.ExternalConnected === 'false' ? false : null;
  const isCharging = values.IsCharging === 'true' ? true : values.IsCharging === 'false' ? false : null;
  const flowWatts = voltageMillivolts !== null && currentMilliamps !== null
    ? voltageMillivolts * currentMilliamps / 1000000 : null;
  const netWatts = flowWatts !== null && Math.abs(flowWatts) <= 300 ? flowWatts : null;
  return {
    voltageMillivolts, currentMilliamps, externalConnected, isCharging,
    reportedChargePercent: number('CurrentCapacity') !== null && number('CurrentCapacity')! >= 0 && number('CurrentCapacity')! <= 100 ? number('CurrentCapacity') : null,
    cycleCount: number('CycleCount') !== null && number('CycleCount')! >= 0 ? number('CycleCount') : null,
    batteryNetWatts: netWatts,
    direction: netWatts === null ? 'unknown' : netWatts < 0 ? 'discharging' : netWatts > 0 ? 'charging' : 'idle',
    source: 'AppleSmartBattery Voltage (mV) and InstantAmperage/Amperage (mA), read through ioreg/plutil',
    meaning: 'Derived signed battery-terminal power (V × I). Negative is battery discharge. This is not wall power, per-app power or a laboratory wattmeter reading.',
  };
}

export function energyDiagnostics(read: NativeReader = readNative) {
  const unavailable: string[] = [];
  const xml = optional(() => read('/usr/sbin/ioreg', ['-r', '-c', 'AppleSmartBattery', '-a']));
  const values: Record<string, string | null> = {};
  for (const key of FIELDS) {
    values[key] = xml ? optional(() => read('/usr/bin/plutil', ['-extract', `0.${key}`, 'raw', '-o', '-', '-'], xml).trim()) : null;
  }
  const battery = parseBattery(values);
  if (battery.voltageMillivolts === null || battery.currentMilliamps === null) unavailable.push('battery electrical readings');
  const foundation = optional(() => JSON.parse(read('/usr/bin/osascript', ['-l', 'JavaScript', '-e', THERMAL_SCRIPT])) as Record<string, unknown>);
  const thermalState = thermalName(foundation?.thermalState);
  if (thermalState === null) unavailable.push('Foundation thermal state');
  const limits = optional(() => read('/usr/bin/pmset', ['-g', 'therm']));
  const speed = limits?.match(/CPU_Speed_Limit\s*=\s*(\d+)/);
  const cpuSpeedLimitPercent = speed && Number(speed[1]) <= 100 ? Number(speed[1]) : null;
  return {
    capturedAt: new Date().toISOString(), battery,
    thermal: { state: thermalState, source: 'Foundation NSProcessInfo.thermalState',
      cpuSpeedLimitPercent, speedLimitSource: 'pmset -g therm',
      temperatureCelsius: null, note: 'Thermal state is a system assessment, not a temperature measurement. Missing speed limits do not prove absence of throttling.' },
    lowPowerMode: typeof foundation?.lowPowerMode === 'boolean' ? foundation.lowPowerMode : null,
    unavailable,
  };
}

export function parseCpuIdle(output: string): number {
  const matches = [...output.matchAll(/CPU usage:.*?([\d.]+)% idle/g)];
  const idle = Number(matches.at(-1)?.[1]);
  if (!matches.length || !Number.isFinite(idle) || idle < 0 || idle > 100) throw new Error('CPU idle reading unavailable');
  return idle;
}

export function cpuIdle(read: NativeReader = readNative): number | null {
  return optional(() => parseCpuIdle(read('/usr/bin/top', ['-l', '2', '-s', '1', '-n', '0'])));
}
