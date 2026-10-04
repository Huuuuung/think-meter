# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Set up

You need Claude Code v2.1.287 or later. No Node.js build step: Claude Code loads the `.ts` files directly.

```bash
git clone https://github.com/Huuuuung/think-meter
cd think-meter
claude --plugin-dir .
```

With `--plugin-dir`, Claude Code hot-reloads the mod when you save, and writes type declarations for your Claude Code version into `.claude-plugin/types/` (git-ignored). Open `.claude-plugin/types/claude-code/index.d.ts` to look up any event or API method.

## Layout

| File | What it holds |
| :- | :- |
| `hooks/register.ts` | The hooks module: wires the mod into Claude Code events |
| `hooks/meter.ts` | Pure timing and formatting logic, no mods API calls |
| `tests/meter.test.ts` | Unit tests for `meter.ts` |
| `tests/register.test.ts` | Tests that drive the mod through Claude Code events |

Keep logic in `meter.ts` where you can, so it stays easy to test.

## Before opening a pull request

```bash
claude plugin validate --strict .claude-plugin/plugin.json
claude plugin validate --strict .claude-plugin/marketplace.json
claude plugin test
```

CI runs the same three commands.

If you add a mods API call, say why in the pull request and update the
"Privacy and permissions" section of both READMEs. Users rely on that list.

## Check the live timer by hand

The test kit runs one dispatch at a time, so it can't draw the spinner while a
response is still streaming. After changing anything in the `turn.step` or
`ui.render` hooks, check in a real session:

1. `claude --plugin-dir .`
2. Ask something that makes Claude think, e.g. a small logic puzzle.
3. The spinner should read `… · thinking Ns…` and count up while Claude thinks.
4. The timer should disappear as soon as text or a tool call starts.
5. A line such as `Cooked for 12s · thinking 4.1s · 86 tok/s` should appear under the answer.
6. `/think-stats` should list the turn.

## Releasing

1. Bump `version` in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
2. Add an entry to `CHANGELOG.md`, including the Claude Code version you tested with.
3. Tag the commit `vX.Y.Z`.

Installed copies are cached by version, so users only get changes after a version bump.
