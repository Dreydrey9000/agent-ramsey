# Release 2.1.0

RAMsey adds one-time macOS onboarding, evidence-based advice, an explicit QuickSilver handoff and a narrated Hyperframes explainer.

## Distribution and companion skill

Target user: a Mac owner using a coding assistant. Useful task: identify current resource pressure and choose one safe next step before a heavy job. The focused companion skill is `skills/ramsey/SKILL.md`; install instructions are in the README. It calls the local CLI or an existing authorized Mac connection. No account login, API key, cloud telemetry or private connection is included. Public examples and the exercise are read-only.

The CLI and skill were tested locally; the Jax installation was separately verified against an authorized Mac connection. Cloud plugin listing, submission and publication are not part of this release. A future authenticated bridge would need explicit account/data permissions and review; it is not simulated by the current local skill. Support cost is ordinary Node/macOS compatibility maintenance. Adoption is not measured; the collector sends no telemetry. Users enter through the README and can keep the standalone CLI without an assistant.

## Evidence

- 37 fixture tests and strict TypeScript checking.
- Real Mac onboarding, status, removal and re-onboarding; a subsequent scheduled reading verified.
- Private monitor-state corruption recovery and loaded-job identity checks.
- Hyperframes project: 1920×1080, 30 fps, 48.5 seconds. Narration, captions, original score and editable source included. Motion, runtime, contrast and craft checks run on the assembled composition.

See `video/QA.md` for media verification and `docs/diagrams/` for the current workflow.
