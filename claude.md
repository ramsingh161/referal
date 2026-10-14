Optimize for minimal context usage without compromising correctness.

Before reading files:
1. Use grep/glob/search to identify likely relevant files.
2. Read only the necessary sections/files.
3. Do not recursively inspect unrelated directories.
4. Do not reread unchanged files already understood in this task.
5. Prefer targeted tests/lint/typecheck for changed modules.
6. Keep responses concise; spend tokens on implementation, not narration.
7. For large tasks, write progress and decisions to .claude/progress.md.
8. After solving a subtask, avoid exploring unrelated improvements.