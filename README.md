![Agent RAMsey, an illustrated ram operative in a dark coat against ivory paper and burnt-orange accents.](assets/ramsey-hero.jpg)

# Agent RAMsey

Agent RAMsey helps humans and coding assistants keep a Mac responsive. It measures CPU and memory use, protects active work, and gives one evidence-based next step. Onboard once for lightweight checks at login; full diagnostics stay available on demand.

RAMsey also answers to **Agent RAMsey**, **RAMsey**, **Agent RAM**, **the RAM agent** and **my RAM guy**.

## Start

Requires **macOS** and **Node.js 22.18 or newer**. Runtime TypeScript support is built into that Node version. There are no package dependencies, API keys or model downloads.

```sh
git clone https://github.com/Dreydrey9000/agent-ramsey.git
cd agent-ramsey
node cli.mts --help
node cli.mts check --workload development
```

For a local command, keep the checkout in place and run:

```sh
node install.mts
```

This installs `ramsey` into `~/.local/bin`. Add that directory to your PATH if needed. The installer refuses to overwrite an existing command. To use another directory:

```sh
node install.mts --bin-dir ./local-bin
```

An optional companion skill is in `skills/ramsey/SKILL.md`. Copy it into your assistant's skill directory, or install it into a new directory:

```sh
node install.mts --bin-dir ./local-bin --skill-dir ./local-skills/ramsey
```

A remote assistant needs its own existing, authorized connection to the Mac. No private connection, key or remote account is shipped.

## Onboard once

```sh
ramsey onboard
ramsey status
```

This installs an owned macOS LaunchAgent: one native check every **five minutes**, at background priority, after login while the Mac is awake. It runs no resident AI model and makes no network calls. Normal readings stay quiet. Warning pressure needs two consecutive readings; critical pressure alerts immediately, including escalation from a warning. Missing pressure needs three readings. Local notices have a one-hour cooldown and depend on macOS notification permission. `status` reports the last reading and whether it is fresh; it does not prove that a notification was displayed.

Keep the checkout and Node executable in place. The monitor recovers from malformed monitor state by preserving one private backup and restarting its persistence counter. An unsafe state file or foreign LaunchAgent is refused. To stop checks and remove only this installation’s job:

```sh
ramsey offboard
```

History is retained. No app is automatically quit, restarted or cleared. A sleeping or logged-out Mac is not monitored.

## RAMsey + QuickSilver

```sh
ramsey handoff --workload development --json
```

RAMsey checks **Mac capacity**. [QuickSilver](https://github.com/always-be-shipping-hq/quicksilver) measures **one app bottleneck**, proposes one small fix and proves the latency result. RAMsey’s handoff includes an observation window, protected-work rules and the before/after measurement contract. An assistant coordinates this on demand; the collector does not invoke another agent or start a polling loop. See the [team playbook](docs/QUICKSILVER.md).

## Watch the explainer

[![Watch Operation Headroom, a 48.5-second explanation of Agent RAMsey.](assets/ramsey-hero.jpg)](assets/ramsey-explainer.mp4)

[Play or download the video](assets/ramsey-explainer.mp4) · [Editable Hyperframes project, transcript and rebuild instructions](video/README.md)

## The five upgrades

![RAMsey's toolkit: history, helper inspection, active-work awareness, capacity checks, and energy and heat diagnostics. These are capability illustrations, not live measurements.](assets/ramsey-toolkit.jpg)

| Feature | Commands | What it does |
|---|---|---|
| History and comparisons | `history`, `compare` | Retains selected measurements and compares checks with matching context |
| Repeated-helper inspection | `helpers` | Shows possible repeated helpers with ancestry and listener evidence |
| Active-work awareness | `protect`, `work`, `unprotect` | Registers known tasks by PID, start time and expiry |
| Capacity preflight | `preflight` | Gives go, wait or unknown using supplied job budgets |
| Energy and heat | `energy` | Reads battery electrical data and the system thermal assessment |

### Check and compare

```sh
ramsey check --workload development --json
ramsey check --samples 6 --interval 5 --workload development --json
ramsey history --json
ramsey compare --json
```

The default check uses three five-second intervals. Checks are bounded to 12 intervals of at most 10 seconds. History retains at most **100 entries over 14 days**, under `~/.local/state/ramsey`. Set `RAMSEY_STATE_DIR` to choose a different private state directory, or use `check --no-history`.

Comparisons require the same installation, declared workload and sample settings. Unknown or different workloads are not comparable. A growing-memory hint needs three comparable checks spanning at least 30 seconds. It is a reason to investigate, not proof of a leak.

### Inspect helpers and protect work

```sh
ramsey helpers --json
ramsey protect --pid 12345 --kind render --ttl-minutes 120
ramsey work --json
ramsey unprotect --pid 12345
```

Use a real PID identified by you or the owning tool. A registration changes metadata only. It expires and does not attach to a reused PID. Unknown work remains protected by default.

Helpers are **candidates**, not confirmed duplicates. Separate services can legitimately use the same executable. RAMsey exposes ownership evidence and bounded process IDs without collecting command arguments.

### Check a job budget

```sh
ramsey preflight --job render --memory-gib 4 --cpu-cores 2 --json
```

Supply a measured or explicit job budget. Missing budgets stay unknown. Memory headroom combines free pages with speculative pages. It also includes purgeable pages and keeps a 0.5 GiB reserve. It excludes inactive/compressed pages and does not predict all memory macOS could reclaim. A go result reserves nothing. Local-model jobs still need their existing guard's preflight.

### Inspect energy and heat

```sh
ramsey energy --json
```

Battery terminal power is derived from native voltage and current. It differs from wall power and per-app power. Positive means charging and negative means discharging. Desktop Macs or unsupported sensors can return unavailable readings.

Heat diagnostics use [Apple's system thermal state](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum) and any CPU speed limit reported by `pmset`. Thermal state is not a temperature reading. No admin access is required.

## Measurement limits and privacy

- CPU 100% means one logical core. CPU-time deltas are measured across intervals. New or short-lived processes can be missed.
- Memory uses summed resident size, or RSS. Shared pages can be counted twice. RSS does not predict reclaimable RAM. [Apple's memory guide](https://support.apple.com/guide/activity-monitor/view-memory-usage-actmntr1004/mac) explains pressure and supporting metrics.
- Active-work awareness uses explicit registrations. It does not inspect recordings, documents, screens or project files.
- History strips process IDs and executable paths. It still contains app names and should stay private. Files are owner-readable/writable only.
- Raw battery registry data is filtered to allowlisted fields. Serial numbers are not reported or stored.
- Missing readings stay unknown. No apps are stopped, files cleared or guards bypassed. Explicit onboarding installs only RAMsey’s own scheduled check and local notices.

If `work.lock` remains after a crash, verify that no RAMsey registry update is running before removing that lock from the state directory. History corruption produces an error rather than a reassuring empty result.

## Development

```sh
npm test
npm run check:public
npm run verify
```

The fixture tests run on macOS and Linux. Live collection requires a Mac. Runtime type stripping does not type-check code. `tsconfig.json` enables strict checking for maintainers with an installed TypeScript compiler and Node typings.

The public-file check uses an explicit allowlist and rejects private machine paths and credential patterns. Local reports and connection notes are excluded from Git. CI runs the tests and public-file check on macOS and Linux.

## RAMsey's identity

<img src="assets/ramsey-avatar.jpg" alt="Agent RAMsey's ram portrait, with curled horns, an earpiece and a dark coat." width="160" height="160">

The selected look is an original noir operative illustration. The [cover](assets/ramsey-hero.jpg), [avatar](assets/ramsey-avatar.jpg) and [toolkit](assets/ramsey-toolkit.jpg) use one coordinated identity. See the [artwork notes](assets/README.md).

See the [architecture guide](docs/ARCHITECTURE.md), editable [workflow](docs/diagrams/workflow.mmd), [rendered diagram](docs/diagrams/workflow.svg) and [change log](CHANGELOG.md).
