# Architecture

The command collects evidence and returns a report. A coding assistant can interpret that report using the companion skill. There is no model or network API inside the collector. Optional onboarding schedules a short native pressure check every five minutes; no process remains resident between checks.

| Module | Responsibility |
|---|---|
| monitor.mts | Process snapshots, interval CPU accounting, app grouping and memory readings |
| native.mts | Fixed native-command execution with timeout and bounded output |
| energy.mts | Allowlisted battery fields, Foundation thermal state and CPU idle sampling |
| helpers.mts | Accessible TCP-listener metadata, helper candidates and active-work ancestry |
| state.mts | Atomic private history, workload comparisons and expiring task registrations |
| preflight.mts | Conservative go, wait or unknown advice using explicit job budgets |
| advice.mts | Evidence-based next step and QuickSilver handoff contract |
| watcher.mts | Quiet pressure policy, bounded private monitor state and local notices |
| onboarding.mts | Owned login LaunchAgent install, verification, status and removal |
| cli.mts | Command validation, report assembly and output |

See the editable [workflow diagram](diagrams/workflow.mmd) and [rendered overview](diagrams/workflow.svg).

Native reads use fixed executables and argument arrays. JSON receives selected battery fields only, never the raw registry dump. Command arguments, environment values and project contents are not collected. The injected NativeReader lets tests cover missing tools without needing a Mac.

History uses at most 100 entries over 14 days in an owned state directory. Each entry is written atomically with owner-only file permissions. Entries hold the union of the largest CPU/memory groups, with process IDs and executable paths removed. Comparisons require the same installation, declared workload and sample settings. Missing apps do not become zero-memory apps.

The active-work registry records PID plus process start time and an expiry. An observed descendant can inherit that task context. Unregistered work remains protected. Registry updates use an exclusive lock. A failed lock does not authorize removing it while another command may be writing.

Preflight treats requested budgets as supplied facts, not measured job requirements. Its memory estimate excludes inactive and compressed pages. A go result is advisory and reserves nothing. Local inference also needs approval from its existing guard.

Monitor state is one atomic private file. Corrupt monitor state is preserved in one private backup; unsafe files are refused. launchd serializes scheduled invocations. Manual overlapping invocations can lose a persistence increment and should be avoided. Notifications depend on macOS settings. The QuickSilver handoff is instruction-based coordination by an assistant, with no automatic agent calls.
