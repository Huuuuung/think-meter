import { expect, test } from 'claude-code/testing'
import {
  addStep,
  breakdown,
  coveredMs,
  emptyTurn,
  finishStep,
  finishTurn,
  formatCount,
  formatLiveSeconds,
  formatSessionSummary,
  formatSpan,
  formatTurnLine,
  liveSuffix,
  median,
  newStepTimes,
  tokensPerSecond,
  TURN_WORDS,
  turnWord,
} from '../hooks/meter.ts'

test('formatSpan reads like the terminal turn line', async () => {
  expect(formatSpan(-5)).toBe('0.0s')
  expect(formatSpan(380)).toBe('0.4s')
  expect(formatSpan(3940)).toBe('3.9s')
  expect(formatSpan(9960)).toBe('10s')
  expect(formatSpan(55100)).toBe('55s')
  expect(formatSpan(59600)).toBe('1m 0s')
  expect(formatSpan(64000)).toBe('1m 4s')
})

test('turnWord picks a terminal word, the same one for the same turn', async () => {
  expect(TURN_WORDS).toContain(turnWord('turn-1'))
  expect(turnWord('turn-1')).toBe(turnWord('turn-1'))
})

test('formatCount and formatLiveSeconds', async () => {
  expect(formatCount(999)).toBe('999')
  expect(formatCount(1234567)).toBe('1,234,567')
  expect(formatLiveSeconds(3999)).toBe('3s')
})

test('liveSuffix shows whole seconds of thinking', async () => {
  expect(liveSuffix(100, 2200)).toBe(' · thinking 2s…')
  expect(liveSuffix(500, 400)).toBe(' · thinking 0s…')
})

test('finishStep splits thinking from streaming', async () => {
  const t = newStepTimes(0)
  t.firstChunkAt = 300
  t.firstVisibleAt = 3300
  t.endedAt = 4300
  expect(finishStep(t, 'm', 400)).toEqual({
    model: 'm',
    ttftMs: 300,
    thinkMs: 3000,
    streamMs: 4000,
    outputTokens: 400,
    sawThinkingText: false,
  })
})

test('a thinking-only response counts entirely as thinking', async () => {
  const t = newStepTimes(0)
  t.firstChunkAt = 100
  t.endedAt = 2100
  expect(finishStep(t, 'm', 50)?.thinkMs).toBe(2000)
})

test('nothing streamed means no stats', async () => {
  expect(finishStep(newStepTimes(0), 'm', 10)).toBe(null)
})

test('tokens per second refuses samples that are too short', async () => {
  expect(tokensPerSecond(400, 4000)).toBe(100)
  expect(tokensPerSecond(10, 200)).toBe(null)
  expect(tokensPerSecond(0, 4000)).toBe(null)
})

test('median handles odd, even and empty lists', async () => {
  expect(median([3, 1, 2])).toBe(2)
  expect(median([4, 1, 2, 3])).toBe(2.5)
  expect(median([])).toBe(0)
})

test('turn line sums requests and flags interruptions', async () => {
  const step = { model: 'm', ttftMs: 0, thinkMs: 1000, streamMs: 2000, outputTokens: 100, sawThinkingText: true }
  const turn = addStep(addStep(emptyTurn(), step), step)
  expect(formatTurnLine(turn, false, 'Cooked')).toBe('Cooked for 4.0s · thinking 2.0s · 50 tok/s')
  expect(formatTurnLine(turn, true)).toBe('Interrupted after 4.0s · thinking 2.0s · 50 tok/s')
})

test('the line leaves off thinking under a second and a rate it cannot trust', async () => {
  const quick = { model: 'm', ttftMs: 800, thinkMs: 300, streamMs: 400, outputTokens: 20, sawThinkingText: false }
  expect(formatTurnLine(addStep(emptyTurn(), quick), false, 'Brewed')).toBe('Brewed for 1.2s')
})

test('coveredMs counts overlapping tool calls once', async () => {
  expect(coveredMs([])).toBe(0)
  expect(coveredMs([[0, 1000], [2000, 2500]])).toBe(1500)
  expect(coveredMs([[0, 1000], [500, 3000], [2000, 2500]])).toBe(3000)
  expect(coveredMs([[100, 50]])).toBe(0)
})

test('breakdown adds up to the turn total', async () => {
  const step = { model: 'm', ttftMs: 1000, thinkMs: 3000, streamMs: 5000, outputTokens: 100, sawThinkingText: false }
  const turn = finishTurn(addStep(emptyTurn(), step), 20000, 9000)
  expect(breakdown(turn)).toEqual({
    totalMs: 20000,
    waitMs: 1000,
    thinkMs: 3000,
    writeMs: 2000,
    toolMs: 9000,
    otherMs: 5000,
  })
  expect(formatTurnLine(turn, false)).toBe('Worked for 20s · thinking 3.0s · 20 tok/s')
})

test('a reported total shorter than the measured parts gives way to them', async () => {
  const step = { model: 'm', ttftMs: 500, thinkMs: 1000, streamMs: 2000, outputTokens: 10, sawThinkingText: false }
  const b = breakdown(finishTurn(addStep(emptyTurn(), step), 100, 0))
  expect(b.totalMs).toBe(2500)
  expect(b.otherMs).toBe(0)
})

test('session summary groups requests by model', async () => {
  const a = { model: 'opus', ttftMs: 1000, thinkMs: 2000, streamMs: 4000, outputTokens: 400, sawThinkingText: false }
  const b = { model: 'sonnet', ttftMs: 500, thinkMs: 0, streamMs: 1000, outputTokens: 90, sawThinkingText: false }
  const summary = formatSessionSummary([finishTurn(addStep(addStep(emptyTurn(), a), b), 12000, 4000)], [a, b])
  expect(summary).toBe(
    [
      '1 turn · 12s in all · 12s median',
      'thinking 2.0s · writing 3.0s · tools 4.0s · waiting 1.5s · other 1.5s',
      'opus · 1 request · 400 output tok · 100 tok/s · 1.0s median wait',
      'sonnet · 1 request · 90 output tok · 90 tok/s · 0.5s median wait',
      'No thinking text was streamed, so thinking is the time before visible output.',
    ].join('\n')
  )
  expect(formatSessionSummary([], [])).toBe('No turns measured yet in this session.')
})
