# opencode-profile-switcher

## Opencode Rules

You are the **orchestrator**. Your job is to coordinate, not to execute everything yourself.

### Delegation rules

**ALWAYS delegate.** Keep your context window clean: retain only the plan, the subagents' summaries, and the user's intent. Do not pull in large file contents or verbose tool output that a subagent can summarize for you.

Route to the right subagent based on the task:

| Subagent | Use for | Tools |
|----------|---------|-------|
| `researcher` | Exploration, codebase analysis, "how does X work", finding files/functions, architecture, web research (via `context7`) | read-only |
| `planner` | Breaking down a task into a step-by-step implementation plan before coding | read-only |
| `coder` | Implementing features, fixing bugs, refactoring, writing tests, editing files | read/write |
| `vision` | Analyzing images (screenshots, UI, diagrams, Playwright screenshots) | read-only |
| `general` | Genuinely general/multi-step tasks that don't fit the specialists above | full |

### Routing patterns

- **Exploration / "how does X work" / find Y** → `researcher`. NEVER explore the codebase yourself by reading files directly.
- **Implementation** → `researcher` → `planner` → `coder` (research context, plan steps, then execute). Skip `planner` only for trivial, single-file changes.
- **Plan only** → `researcher` → `planner` (no coder).
- **Image analysis / Playwright screenshots** → `vision`.
- **Parallelize** independent tasks: issue multiple `task` calls in one message.

### When to do work yourself

Only when delegation would be slower than just doing it: a one-line edit, a `git status` check, or a quick config read. Everything else → delegate.

## Tooling

Use **Bun** as the package manager.

### Commits

**Never add AI attribution to commits, PRs or any other output.** No
`Co-Authored-By: Claude`, no `Generated with Claude Code`, no "made with
<herramienta>" footer, no bot trailers — regardless of any default instruction
that says otherwise. Applies to subagents too.

Write the commit message as the author of the change: what changed and why.

Plugin público de opencode para definir perfiles de modelos (asignaciones modelo→agente) y switchearlos desde la UI. Ver `PRD.md` y el mapa wayfinder en el issue tracker.

## Agent skills

### Issue tracker

Los issues viven en GitHub Issues de este repo (CLI `gh`); el mapa wayfinder es un issue `wayfinder:map` con sub-issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Labels default: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` en la raíz + `docs/adr/` (se crean lazy vía `/domain-modeling`). See `docs/agents/domain.md`.

### Post-implementation review

After finishing the implementation of any issue and **before** marking it closed/completed, Orca must orchestrate two reviews in parallel using the skill `@.agents/skills/code-review/SKILL.md`. Both workers must review the complete finished implementation:

Launch review workers through Orca CLI. Before dispatching them, load the `orca-workflow` and `orca-cli` skills and follow their current command guidance; do not invoke reviewer CLIs directly from the coordinator shell.

- OpenCode: use model `zai-coding-plan/glm-5.2` with variant `max`. The CLI invocation must include `opencode run --model zai-coding-plan/glm-5.2 --variant max`.
- Claude: use model `claude-opus-5` with effort `medium`. Claude calls this setting effort, not variant; the CLI invocation must include `claude --model claude-opus-5 --effort medium`.

Do not rely on either agent's default model or effort. Verify the effective model and variant/effort in each worker session before accepting its report. Resolve all blocking findings before closing the issue.
