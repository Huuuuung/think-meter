// Pure timing and formatting logic for think-meter.
// Nothing in this file touches the mods API, so it can be unit-tested directly.

/** Chunk kinds that mean the model has started producing visible output. */
const VISIBLE_KINDS = new Set(['text', 'tool', 'input'])

/** Below this much streaming time, tokens/second is too noisy to report. */
export const MIN_STREAM_MS_FOR_RATE = 500

/** Timestamps (ms) collected while one model request streams. */
export type StepTimes = {
  /** When the request was handed on (before the first chunk). */
  sentAt: number
  /** When the first chunk of any kind arrived. */
  firstChunkAt: number | null
  /** When the first visible chunk (text or tool call) arrived. */
  firstVisibleAt: number | null
  /** When the stream finished. */
  endedAt: number | null
  /** Whether any thinking text streamed (false when thinking is hidden or absent). */
  sawThinkingText: boolean
}

/** What one model request cost in time and tokens. */
export type StepStats = {
  model: string
  /** Request sent -> first streamed event (queueing + prompt processing). */
  ttftMs: number
  /** First streamed event -> first visible output (about the thinking time). */
  thinkMs: number
  /** First streamed event -> end of stream. */
  streamMs: number
  outputTokens: number
  sawThinkingText: boolean
}

/** Totals for one turn (one prompt and every request it took). */
export type TurnStats = {
  requests: number
  /** Request sent -> first streamed event, summed over requests. */
  waitMs: number
  thinkMs: number
  streamMs: number
  /** Wall-clock time the main loop's tools ran; parallel calls are counted once. */
  toolMs: number
  /** Wall-clock length of the whole turn, prompt submitted -> answer complete (0 until it ends). */
  totalMs: number
  outputTokens: number
  models: string[]
  sawThinkingText: boolean
}

/** Where one turn's time went. The parts add up to totalMs. */
export type TurnBreakdown = {
  totalMs: number
  waitMs: number
  thinkMs: number
  /** Streaming visible output: text and tool-call arguments. */
  writeMs: number
  toolMs: number
  /** What no measured phase covers: hooks, retries, time between requests. */
  otherMs: number
}

export function newStepTimes(sentAt: number): StepTimes {
  return { sentAt, firstChunkAt: null, firstVisibleAt: null, endedAt: null, sawThinkingText: false }
}

/** True when this chunk kind is the first sign of visible output. */
export function isVisibleKind(kind: string): boolean {
  return VISIBLE_KINDS.has(kind)
}

/** Turns collected timestamps into step stats. Returns null if nothing streamed. */
export function finishStep(times: StepTimes, model: string, outputTokens: number): StepStats | null {
  if (times.firstChunkAt === null || times.endedAt === null) return null
  const first = times.firstChunkAt
  const end = Math.max(times.endedAt, first)
  // A thinking-only response has no visible output: all of it counts as thinking.
  const visible =
    times.firstVisibleAt === null ? end : Math.min(Math.max(times.firstVisibleAt, first), end)
  return {
    model,
    ttftMs: Math.max(0, first - times.sentAt),
    thinkMs: visible - first,
    streamMs: end - first,
    outputTokens: Math.max(0, outputTokens || 0),
    sawThinkingText: times.sawThinkingText,
  }
}

export function emptyTurn(): TurnStats {
  return {
    requests: 0,
    waitMs: 0,
    thinkMs: 0,
    streamMs: 0,
    toolMs: 0,
    totalMs: 0,
    outputTokens: 0,
    models: [],
    sawThinkingText: false,
  }
}

/** Adds one request's stats to a turn's totals, returning a new object. */
export function addStep(turn: TurnStats, step: StepStats): TurnStats {
  return {
    ...turn,
    requests: turn.requests + 1,
    waitMs: turn.waitMs + step.ttftMs,
    thinkMs: turn.thinkMs + step.thinkMs,
    streamMs: turn.streamMs + step.streamMs,
    outputTokens: turn.outputTokens + step.outputTokens,
    models: turn.models.includes(step.model) ? turn.models : [...turn.models, step.model],
    sawThinkingText: turn.sawThinkingText || step.sawThinkingText,
  }
}

/** Wall-clock time covered by [start, end] intervals, overlapping parts counted once. */
export function coveredMs(intervals: Array<[number, number]>): number {
  const sorted = intervals.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0])
  let total = 0
  let runStart = 0
  let runEnd = -Infinity
  for (const [start, end] of sorted) {
    if (start > runEnd) {
      if (runEnd > runStart) total += runEnd - runStart
      runStart = start
      runEnd = end
    } else {
      runEnd = Math.max(runEnd, end)
    }
  }
  if (runEnd > runStart) total += runEnd - runStart
  return total
}

/** Records a finished turn's wall-clock length and tool time. */
export function finishTurn(turn: TurnStats, totalMs: number, toolMs: number): TurnStats {
  return { ...turn, totalMs: Math.max(0, totalMs || 0), toolMs: Math.max(0, toolMs || 0) }
}

/**
 * Splits a turn into wait, thinking, writing, tools and other. When the
 * reported total is shorter than the measured parts (clock skew), the parts win.
 */
export function breakdown(turn: TurnStats): TurnBreakdown {
  const writeMs = Math.max(0, turn.streamMs - turn.thinkMs)
  const measured = turn.waitMs + turn.thinkMs + writeMs + turn.toolMs
  const totalMs = Math.max(turn.totalMs, measured)
  return {
    totalMs,
    waitMs: turn.waitMs,
    thinkMs: turn.thinkMs,
    writeMs,
    toolMs: turn.toolMs,
    otherMs: totalMs - measured,
  }
}

/** Output tokens per second, or null when the sample is too short to trust. */
export function tokensPerSecond(outputTokens: number, streamMs: number): number | null {
  if (streamMs < MIN_STREAM_MS_FOR_RATE || outputTokens <= 0) return null
  return (outputTokens * 1000) / streamMs
}

/** 1234 -> "1,234". Avoids locale differences between machines. */
export function formatCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** The past-tense words Claude Code's terminal closes a turn with ("Cooked for 1m 6s"). */
export const TURN_WORDS = ['Baked', 'Brewed', 'Churned', 'Cogitated', 'Cooked', 'Crunched', 'Sautéed', 'Worked']

/** A word for this turn, the same every time the line is drawn. */
export function turnWord(turnId: string): string {
  let hash = 0
  for (const ch of turnId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return TURN_WORDS[hash % TURN_WORDS.length]
}

/** Like the terminal's turn line: 3.9s, 55s, 1m 4s. */
export function formatSpan(ms: number): string {
  const safe = Math.max(0, ms)
  const tenths = Math.round(safe / 100)
  if (tenths < 100) return (tenths / 10).toFixed(1) + 's'
  const seconds = Math.round(safe / 1000)
  if (seconds < 60) return seconds + 's'
  return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's'
}

/** Parts shorter than this are left off the line. */
export const MIN_PART_MS_TO_SHOW = 1000

/** "thinking 4.0s · writing 21s · tools 16s · waiting 14s", parts under a second left out. */
export function formatParts(b: TurnBreakdown, withOther: boolean): string {
  const parts: Array<[string, number]> = [
    ['thinking', b.thinkMs],
    ['writing', b.writeMs],
    ['tools', b.toolMs],
    ['waiting', b.waitMs],
  ]
  if (withOther) parts.push(['other', b.otherMs])
  return parts
    .filter(([, ms]) => ms >= MIN_PART_MS_TO_SHOW)
    .map(([name, ms]) => name + ' ' + formatSpan(ms))
    .join(' · ')
}

/**
 * The line shown under an answer: "Cooked for 55s · thinking 3.9s · 132 tok/s".
 * Thinking under a second and a rate from too short a sample are left off;
 * the full split is in /think-stats.
 */
export function formatTurnLine(turn: TurnStats, isAborted: boolean, word = 'Worked'): string {
  const b = breakdown(turn)
  const parts = [isAborted ? 'Interrupted after ' + formatSpan(b.totalMs) : word + ' for ' + formatSpan(b.totalMs)]
  if (b.thinkMs >= MIN_PART_MS_TO_SHOW) parts.push('thinking ' + formatSpan(b.thinkMs))
  const rate = tokensPerSecond(turn.outputTokens, turn.streamMs)
  if (rate !== null) parts.push(rate.toFixed(0) + ' tok/s')
  return parts.join(' · ')
}

/**
 * The line for a drawn text block, if the block ends a finished answer.
 * `lines` maps each answer's text to its line, oldest first; the newest match
 * wins, so a short reply that repeats ("Done.") gets the latest turn's line.
 */
export function lineForBlock(lines: Map<string, string>, blockText: string): string | undefined {
  const block = blockText.trim()
  if (block === '') return undefined
  const exact = lines.get(block)
  if (exact !== undefined) return exact
  let found: string | undefined
  for (const [answer, line] of lines) if (answer.endsWith(block)) found = line
  return found
}

/** The block's text with the line beneath it, set apart and in italics. */
export function withLine(blockText: string, line: string): string {
  return blockText.replace(/\s+$/, '') + '\n\n*' + line + '*'
}

/** "1 turn", "2 turns". */
function count(n: number, noun: string): string {
  return formatCount(n) + ' ' + noun + (n === 1 ? '' : 's')
}

/** Median of a list of numbers (0 for an empty list). */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The text /think-stats prints for the session so far. */
export function formatSessionSummary(turns: TurnStats[], steps: StepStats[]): string {
  if (turns.length === 0) return 'No turns measured yet in this session.'
  const lines: string[] = []
  const parts = turns.map(breakdown)
  const sum = (pick: (b: TurnBreakdown) => number) => parts.reduce((total, b) => total + pick(b), 0)
  const totals: TurnBreakdown = {
    totalMs: sum((b) => b.totalMs),
    waitMs: sum((b) => b.waitMs),
    thinkMs: sum((b) => b.thinkMs),
    writeMs: sum((b) => b.writeMs),
    toolMs: sum((b) => b.toolMs),
    otherMs: sum((b) => b.otherMs),
  }
  lines.push(
    count(turns.length, 'turn') +
      ' · ' +
      formatSpan(totals.totalMs) +
      ' in all · ' +
      formatSpan(median(parts.map((b) => b.totalMs))) +
      ' median'
  )
  const split = formatParts(totals, true)
  if (split !== '') lines.push(split)
  const byModel = new Map<string, StepStats[]>()
  for (const step of steps) {
    const list = byModel.get(step.model) ?? []
    list.push(step)
    byModel.set(step.model, list)
  }
  for (const [model, list] of byModel) {
    const out = list.reduce((sum, x) => sum + x.outputTokens, 0)
    const ms = list.reduce((sum, x) => sum + x.streamMs, 0)
    const rate = tokensPerSecond(out, ms)
    lines.push(
      model +
        ' · ' +
        count(list.length, 'request') +
        ' · ' +
        formatCount(out) +
        ' output tok · ' +
        (rate === null ? '- tok/s' : rate.toFixed(0) + ' tok/s') +
        ' · ' +
        formatSpan(median(list.map((x) => x.ttftMs))) +
        ' median wait'
    )
  }
  if (!turns.some((t) => t.sawThinkingText)) {
    lines.push('No thinking text was streamed, so thinking is the time before visible output.')
  }
  return lines.join('\n')
}

/** Whole seconds for the live spinner, so it does not flicker: 3400 -> "3s". */
export function formatLiveSeconds(ms: number): string {
  return Math.max(0, Math.floor(ms / 1000)) + 's'
}

/** What the spinner shows after its word while Claude thinks: " · thinking 3s…". */
export function liveSuffix(startedAt: number, now: number): string {
  return ' · thinking ' + formatLiveSeconds(now - startedAt) + '…'
}
