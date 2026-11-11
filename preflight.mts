import type { systemState } from './monitor.mts';
import type { energyDiagnostics } from './energy.mts';
import type { Workload } from './state.mts';

export type JobBudget = { memoryGiB: number | null; cpuCores: number | null; kind: Workload };

export function assessCapacity(system: ReturnType<typeof systemState>, energy: ReturnType<typeof energyDiagnostics>, idlePercent: number | null, budget: JobBudget) {
  const reasons: string[] = [];
  let decision: 'go' | 'wait' | 'unknown' = 'go';
  const wait = (reason: string) => { decision = 'wait'; reasons.push(reason); };
  const unknown = (reason: string) => { if (decision !== 'wait') decision = 'unknown'; reasons.push(reason); };
  if (system.memoryPressure === 'warning' || system.memoryPressure === 'critical') wait(`Memory pressure is ${system.memoryPressure}`);
  else if (system.memoryPressure !== 'normal') unknown('Memory pressure is unavailable or unknown');
  if (energy.thermal.state === 'serious' || energy.thermal.state === 'critical') wait(`Thermal state is ${energy.thermal.state}`);
  else if (energy.thermal.state === null) unknown('Thermal state is unavailable');
  else if (energy.thermal.state === 'fair') unknown('Thermal state is fair. Capacity may change under added load');
  if (energy.thermal.cpuSpeedLimitPercent !== null && energy.thermal.cpuSpeedLimitPercent < 100) wait('macOS reports a CPU speed limit');
  if (budget.kind === 'local-model' && system.localAiGuard.disabledLatch) wait('The local-AI guard disabled latch is present');
  if (budget.kind === 'local-model') unknown('The existing local-AI guard must also approve inference. This check does not replace its preflight');
  if (budget.memoryGiB === null) unknown('No measured or explicitly supplied job memory budget');
  else if (!Number.isFinite(budget.memoryGiB) || budget.memoryGiB <= 0) unknown('The job memory budget is invalid');
  else if (system.headroomBytes === null || system.totalMemoryBytes === null) unknown('Memory headroom is unavailable');
  else if (budget.memoryGiB * 1073741824 > system.totalMemoryBytes) wait('The requested memory budget exceeds physical memory');
  else if ((budget.memoryGiB + 0.5) * 1073741824 > system.headroomBytes) unknown('The conservative headroom estimate does not cover the budget plus a 0.5 GiB reserve. macOS may reclaim other memory');
  if (budget.cpuCores === null) unknown('No supplied CPU-core budget');
  else if (!Number.isFinite(budget.cpuCores) || budget.cpuCores <= 0) unknown('The CPU-core budget is invalid');
  else if (system.logicalCpus === null || idlePercent === null) unknown('Measured CPU headroom is unavailable');
  else if (budget.cpuCores > system.logicalCpus) wait('The CPU budget exceeds the logical core count');
  else if (budget.cpuCores > idlePercent / 100 * system.logicalCpus) wait('The CPU budget exceeds the observed idle-core estimate');
  return { decision, reasons, budget, memoryHeadroomBytes: system.headroomBytes,
    memoryReserveGiB: 0.5, idleLogicalCoreEstimate: idlePercent !== null && system.logicalCpus !== null ? idlePercent / 100 * system.logicalCpus : null,
    note: 'A point-in-time advisory, not a reservation or a guarantee. Memory headroom sums free, speculative and purgeable pages, excluding inactive and compressed pages. No job was launched and no guard was changed.' };
}
