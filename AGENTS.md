# Agent RAMsey development

- Read README.md and docs/ARCHITECTURE.md before editing.
- Use TypeScript and Node standard libraries. There are no runtime package dependencies.
- Keep native commands behind `NativeReader`. Pass fixed argument arrays, never shell strings built from input.
- The CLI manages only its explicitly onboarded LaunchAgent; it never controls app processes or weakens existing resource guards.
- Unknown work stays protected. Missing readings stay unknown. RSS sums are not reclaimable RAM.
- History must stay local, bounded and stripped of PIDs, full paths and command arguments.
- Run `npm run verify` before release. Check live native behavior on a Mac and integration in a clean consumer.
- Run a strict TypeScript check when a compiler and Node typings are available. Runtime stripping does not type-check code.
- The public allowlist is PUBLIC-FILES.txt. Never add local reports, private connection notes, machine identities or credentials to Git.
- Keep the README-linked workflow diagram current. Update CHANGELOG.md for meaningful changes.
