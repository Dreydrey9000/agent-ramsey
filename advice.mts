import type { Report } from './monitor.mts';

/** Advice is evidence, never authority to interrupt a process. */
export function resourceAdvice(report: Report) {
  const pressure = report.end.memoryPressure;
  const sustained = report.topCpu.find(app => app.cpuPercent >= 100 && app.measuredIntervals >= 2 && app.busyIntervals === app.measuredIntervals);
  const urgent = pressure === 'warning' || pressure === 'critical';
  return {
    priority: urgent ? 'memory-pressure' : sustained ? 'sustained-cpu' : pressure !== 'normal' ? 'measurement-unavailable' : 'healthy',
    evidence: { pressure, windowSeconds: report.windowSeconds, candidate: sustained ? { name: sustained.name, cpuPercent: sustained.cpuPercent } : null },
    nextAction: urgent ? 'Defer additional heavy jobs. Run ramsey check and confirm the owner and purpose of the leading app before making one change.'
      : sustained ? 'Confirm whether the leading CPU user is doing intended work. If its app feels slow, give QuickSilver one reproducible operation to measure.'
      : pressure !== 'normal' ? 'Memory pressure is unavailable. Restore the reading before declaring spare capacity.'
      : 'No memory-pressure action is indicated. Use preflight with an explicit budget before adding a heavy job.',
    protectedWork: 'All active and unknown work stays protected. High RSS alone is not wasted or reclaimable memory.',
    quicksilver: {
      trigger: 'A reproducibly slow app operation or sustained unexpected CPU use, after the owner confirms its purpose.',
      handoff: 'Provide the app, operation, expected workload, this observation window and a same-context before measurement. QuickSilver measures one bottleneck, proposes one small fix, then remeasures.',
      proof: 'QuickSilver compares endpoint or operation latency; RAMsey compares resource readings under the same workload. Report both, including regressions. A speedup is not proof of RAM savings.',
      approval: 'No production deployment or interruption of work without the owner’s approval. No agent-to-agent polling loop.',
    },
  };
}
