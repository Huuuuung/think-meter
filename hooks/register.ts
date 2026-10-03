// think-meter: the terminal's turn timer, for the desktop app, broken down.
//
// How it measures (see README for the caveats):
//   * every model request streams through `turn.step`; the mod timestamps the
//     first streamed event, the first visible output (text or a tool call),
//     and the end of the stream
//   * "for"      = the turn's wall-clock length, prompt submitted -> answer
//                  complete (the terminal's "Cooked for", Codex's "Worked for")
//   * "waiting"  = request sent -> first streamed event
//   * "thinking" = first streamed event -> first visible output
//   * "writing"  = first visible output -> end of stream
//   * "tools"    = wall-clock time the main loop's tool calls ran
//   * "other"    = whatever is left of the turn (in /think-stats only)
//   * "tok/s"    = output tokens (thinking included) / streaming time
//   * a turn's numbers are the sum over its requests; subagents are left out

import {
  addStep,
  coveredMs,
  emptyTurn,
  finishStep,
  finishTurn,
  formatSessionSummary,
  formatTurnLine,
  isVisibleKind,
  lineForBlock,
  liveSuffix,
  newStepTimes,
  turnWord,
  withLine,
  type StepStats,
  type TurnStats,
} from './meter.ts'

/** Keep memory bounded in very long sessions. */
const MAX_HISTORY = 2000

/** Finished turns and requests of the main conversation, for /think-stats. */
let finishedTurns: TurnStats[] = []
let finishedSteps: StepStats[] = []

/** Running totals of turns still in progress, by turn id. */
const openTurns = new Map<string, TurnStats>()
/** When each main-loop tool call of a turn in progress ran, by turn id. */
const openToolRuns = new Map<string, Array<[number, number]>>()
/** The main conversation's turn in progress; tool calls carry no turn id of their own. */
let mainTurnId: string | null = null
/** The line under each finished answer, by the answer's text, oldest first. */
const linesByAnswer = new Map<string, string>()

/** When the main conversation's current request entered its thinking phase. */
let liveThinkStart: number | null = null
/** The timer that redraws the spinner while thinking. */
let liveTimer: { cancel: () => void } | null = null

function stopLiveTimer(): void {
  if (liveTimer !== null) liveTimer.cancel()
  liveTimer = null
  liveThinkStart = null
}

function remember<T>(list: T[], item: T): T[] {
  const next = [...list, item]
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next
}

export function register(on: any, options: any) {
  const showTurnLine = options?.showTurnLine !== false
  const liveSpinner = options?.liveSpinner !== false

  // A reload starts from a clean slate.
  finishedTurns = []
  finishedSteps = []
  openTurns.clear()
  openToolRuns.clear()
  linesByAnswer.clear()
  mainTurnId = null
  stopLiveTimer()

  on('session.start', async ($: any, e: any, next: any) => {
    await $.command.register({
      name: 'think-stats',
      description: 'Show thinking time and output speed for this session',
    })
    return next(e)
  })

  on('command.run', { command: 'think-stats' }, async () => {
    return { text: formatSessionSummary(finishedTurns, finishedSteps) }
  })

  on('turn.step', async function* ($: any, e: any, next: any) {
    const isMain = !e.agentId
    if (isMain) mainTurnId = e.turnId
    const times = newStepTimes(await $.clock.now())
    const stream = next(e)
    try {
      for await (const chunk of stream) {
        if (times.firstChunkAt === null) {
          times.firstChunkAt = await $.clock.now()
          if (isMain && liveSpinner) {
            stopLiveTimer()
            liveThinkStart = times.firstChunkAt
            liveTimer = $.clock.every(500, () => $.ui.invalidate('ui.render'))
          }
        }
        if (chunk.kind === 'thinking' && chunk.text) times.sawThinkingText = true
        if (times.firstVisibleAt === null && isVisibleKind(chunk.kind)) {
          times.firstVisibleAt = await $.clock.now()
          if (isMain && liveThinkStart !== null) {
            stopLiveTimer()
            $.ui.invalidate('ui.render')
          }
        }
        yield chunk
      }
    } finally {
      if (isMain && liveThinkStart !== null) {
        stopLiveTimer()
        $.ui.invalidate('ui.render')
      }
    }

    const result = await stream.result
    times.endedAt = await $.clock.now()

    if (isMain && result) {
      const usage = result.usage
      const step = finishStep(times, usage?.model ?? e.model, usage?.output_tokens ?? 0)
      if (step !== null) {
        finishedSteps = remember(finishedSteps, step)
        openTurns.set(e.turnId, addStep(openTurns.get(e.turnId) ?? emptyTurn(), step))
      }
    }
    return result
  })

  // Only the timing is recorded; the tool's arguments and result pass through untouched.
  on('tool.call', async ($: any, e: any, next: any) => {
    const turnId = mainTurnId
    if (e.agentId || turnId === null) return next(e)
    const startedAt = await $.clock.now()
    try {
      return await next(e)
    } finally {
      const runs = openToolRuns.get(turnId) ?? []
      runs.push([startedAt, await $.clock.now()])
      openToolRuns.set(turnId, runs)
    }
  })

  on('ui.render', { component: 'Spinner' }, async ($: any, e: any, next: any) => {
    if (liveThinkStart === null) return next(e)
    const now = await $.clock.now()
    return next({ ...e, props: { ...e.props, suffix: liveSuffix(liveThinkStart, now) } })
  })

  on('turn.complete', async ($: any, e: any, next: any) => {
    const result = await next(e)
    if (e.agentId) return result

    const measured = openTurns.get(e.turnId)
    const toolRuns = openToolRuns.get(e.turnId) ?? []
    openTurns.delete(e.turnId)
    openToolRuns.delete(e.turnId)
    if (mainTurnId === e.turnId) mainTurnId = null
    stopLiveTimer()
    if (measured === undefined || measured.requests === 0) return result

    const turn = finishTurn(measured, e.durationMs, coveredMs(toolRuns))
    finishedTurns = remember(finishedTurns, turn)
    if (!showTurnLine) return result

    // The line is drawn under the answer by the AssistantMessage hook below, not
    // returned here: the desktop app folds a turn.complete line into a notice
    // the person has to click open.
    const answer = typeof e.answer === 'string' ? e.answer.trim() : ''
    if (showTurnLine && answer !== '') {
      linesByAnswer.delete(answer)
      linesByAnswer.set(answer, formatTurnLine(turn, e.isAborted === true, turnWord(e.turnId)))
      if (linesByAnswer.size > MAX_HISTORY) linesByAnswer.delete(linesByAnswer.keys().next().value)
      $.ui.invalidate('ui.render')
    }
    return result
  })

  // Only the drawing changes: the stored reply, and what the model reads, stay as they were.
  on('ui.render', { component: 'AssistantMessage' }, async ($: any, e: any, next: any) => {
    const line = typeof e.props?.text === 'string' ? lineForBlock(linesByAnswer, e.props.text) : undefined
    if (line === undefined) return next(e)
    return next({ ...e, props: { ...e.props, text: withLine(e.props.text, line) } })
  })

  on('session.end', async ($: any, e: any, next: any) => {
    stopLiveTimer()
    return next(e)
  })
}
