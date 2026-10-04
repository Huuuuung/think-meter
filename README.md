# think-meter: a turn timer for Claude Code

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that brings the terminal's turn timer to the Claude desktop app, and breaks it down.

[中文说明](./README.zh-CN.md) · An unofficial community project, not affiliated with or endorsed by Anthropic.

In the terminal, Claude Code ends each answer with a line like `Cooked for 1m 6s`. The desktop app's Code tab doesn't show it (as of October 2026), so once a turn finishes you can't tell how long it took. think-meter adds that line back, with what neither shows: how long Claude thought, how fast it wrote, a live thinking timer, and in `/think-stats` where the time went (thinking, writing, tools, waiting). It works the same in the terminal, where its total matches the built-in one.

Under each answer, in the terminal line's own words:

```
✻ Cooked for 55s · thinking 3.9s · 132 tok/s
```

![The line under an answer in the Claude Code desktop app](docs/turn-line.png)

While Claude is thinking, beside the spinner:

```
Pondering · thinking 3s…
```

And `/think-stats` for the session so far:

```
✻ 12 turns · 6m 41s in all · 24s median
thinking 48s · writing 1m 2s · tools 4m 13s · waiting 38s · other 10s
claude-opus-5-5 · 31 requests · 18,402 output tok · 142 tok/s · 1.2s median wait
```

## Install

Tested with Claude Code 2.1.285 (CLI) and 2.1.286 (desktop app). Check yours with `claude --version`.

> **Mods are in early access.** If think-meter installs but nothing shows up, mods aren't on for your setup yet. Add this to `~/.claude/settings.json`, then start a new chat. It works for both the terminal and the desktop app:
>
> ```json
> "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" }
> ```
>
> This turns on mods from every plugin you install, not just this one. Running `claude --debug` prints why a mod didn't load.

In Claude Code:

```
/plugin marketplace add Huuuuung/think-meter
/plugin install think-meter@think-meter
```

Or try it without installing, from a clone:

```bash
git clone https://github.com/Huuuuung/think-meter
claude --plugin-dir ./think-meter
```

## Options

Open `/plugin`, pick **think-meter**, then **Configure options**:

| Option | Default | What it does |
| :- | :- | :- |
| `showTurnLine` | `true` | The line under each answer |
| `liveSpinner` | `true` | The live thinking timer beside the spinner |

`/think-stats` is always available.

## How it measures

**Cooked for 55s** is the turn's wall-clock length as Claude Code reports it: from submitting the prompt until the answer is complete. It's the span the terminal's own line shows, and the one [Codex](https://github.com/openai/codex) shows as "Worked for". The word is drawn from the terminal's own set (Baked, Brewed, Churned, Cogitated, Cooked, Crunched, Sautéed, Worked).

After it, the line gives:

| Number | How |
| :- | :- |
| **thinking** | first streamed event → first visible output (text or a tool call); left off under a second |
| **tok/s** | output tokens ÷ streaming time (first streamed event → end of stream); left off for very short replies |

`/think-stats` splits the session's time into five parts that add up to the total:

| Part | Measured from | To |
| :- | :- | :- |
| **thinking** | the first streamed event | the first visible output |
| **writing** | the first visible output | end of stream (text and tool-call arguments) |
| **tools** | a tool call starting | it returning (calls running in parallel count once) |
| **waiting** | request handed on | first streamed event (queueing, reading the context) |
| **other** | whatever is left of the turn | hooks, retries, gaps between requests |

And per model: requests, output tokens (thinking included), tok/s, and the median wait.

Model requests stream through the `turn.step` event and tools run through `tool.call`. think-meter timestamps them and changes nothing: every chunk, tool argument and tool result is passed on as it was. A turn's numbers are summed over every request it made (one per tool-use round).

### Caveats, please read

- **thinking is an approximation.** Claude Code hides thinking text by default on many plans, so the mod can't rely on seeing it. Instead it measures the wait between the stream starting and visible output appearing. When the model thinks, that wait *is* the thinking; when it doesn't, the number is near zero. `/think-stats` tells you when no thinking text was seen at all.
- **tok/s includes thinking tokens**, because the API bills and counts them as output tokens. It's the model's streaming speed, not the speed of the text you read.
- **Short replies have no tok/s** (shown as `-`). Under 0.5 s of streaming, fixed overhead dominates and the number would mislead.
- **tools can include waiting for you.** If Claude Code asks permission for a tool, the time until you answer can count as tool time.
- **Subagents are left out.** Only the main conversation is measured. A subagent's whole run shows up as the main turn's tool time, since it runs inside the Agent tool.
- **Numbers reset** when the mod reloads or the session restarts, and answers from before that lose their line.

## Privacy and permissions

Mods are not sandboxed and run with Claude Code's own access, so you should know what one touches. think-meter calls only these mods API methods, as `claude plugin validate` reports:

```
calls: $.clock.every, $.clock.now, $.command.register, $.ui.invalidate
```

It hooks `turn.step` and `tool.call` only to timestamp them, and the drawing of Claude's replies (`ui.render` on `AssistantMessage`) only to add the line under the last one; the stored reply, and what the model reads, stay as they were. No files, no network, no processes, no environment variables, nothing stored on disk. In memory it keeps timings, token counts, and the text of recent answers, which is how it finds the block to draw the line under. It never writes down or sends your prompts, answers, thinking text, tool arguments or tool results. Verify it yourself:

```bash
claude plugin validate .claude-plugin/plugin.json
```

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md).

```bash
claude plugin validate --strict .claude-plugin/plugin.json
claude plugin test
```

## License

[MIT](./LICENSE)
