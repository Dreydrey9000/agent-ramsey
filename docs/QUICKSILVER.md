# RAMsey and QuickSilver

1. RAMsey checks current pressure, measured CPU, work context and capacity before more heavy work starts. High RSS alone is never proof of waste.
2. If the owner reports a reproducibly slow app operation, run `ramsey handoff --workload development --json`. Name the app and exact operation. Keep raw process data private.
3. Give QuickSilver that operation and a same-workload before measurement. QuickSilver measures its latency and traces one bottleneck. It proposes the smallest fix. Production deployment still needs explicit approval.
4. Repeat the same app measurement after the fix. Run RAMsey again with the same declared workload and sample settings; `ramsey compare` refuses incompatible checks.
5. Report app latency and resource readings separately. Never turn summed RSS into promised RAM savings. If a fix fails, revert only that run’s own isolated change after checking for other edits.

The link is a documented handoff used by a coordinating assistant, not automatic remote execution. Both agents retain their existing permissions. No persistent agent chatter or model residency is needed. Scheduled RAMsey monitoring only reads native memory pressure; deep CPU, helper, capacity and energy checks are on demand.

QuickSilver kit: https://github.com/always-be-shipping-hq/quicksilver
