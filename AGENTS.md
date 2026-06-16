# Project Agent Entry

This is a thin entry for agents opened directly inside the Kneeboard repo.

## Read First

1. `.agent-project.yml` in this folder.
2. `../../../PROJECT_CONTEXT.md`
3. `../../../000_Agent/AGENT_ROUTING.md`
4. `../../../000_Agent/memory/MEMORY.md`
5. The memory files listed in `.agent-project.yml`.

## Working Rules

- Treat this folder as the Kneeboard Git working root.
- Confirm the Git root with `git rev-parse --show-toplevel` before commit or push.
- Keep commits separated by repo. For cross-project work, coordinate through a shared spec under `../../../100_Todo/plans/`.
- Do not write secrets into this project. Secrets live in `../../../000_Agent/.secrets/secrets.env`.
- Use `../../../PROJECT_MAP.md` when looking for project files, memory, skills, or scripts.

## Multi-Agent Use

- Codex owns local edits, Git/GitHub, browser/UI verification, and final integration.
- Claude is best for architecture review, long-context reasoning, Home Assistant logic, and second opinion.
- AGY is best for large read-only scans, long logs, repeated outputs, and parallel subtasks. Verify AGY output before applying it.
