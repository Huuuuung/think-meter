# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-03

First release. Tested with Claude Code 2.1.285 (CLI) and 2.1.286 (desktop app).

### Added

- A line under each answer, like the terminal's own turn line: `✻ Cooked for 55s · thinking 3.9s · 132 tok/s`. It is drawn in italics under the reply's last paragraph, so the desktop app shows it without folding it into a notice
- The total is the turn's wall-clock length, prompt submitted to answer complete: the span the terminal shows as "Cooked for" and Codex as "Worked for"
- A live thinking timer beside the spinner
- `/think-stats`: session totals, the split into thinking, writing, tools, waiting and other, and per-model output tokens, tok/s and median wait
- `showTurnLine` and `liveSpinner` options
