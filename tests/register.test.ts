import { expect, test } from 'claude-code/testing'
import { turnWord } from '../hooks/meter.ts'

/** How the line under an answer opens for a turn id. */
const opens = (turnId: string, span: string) => '✻ ' + turnWord(turnId) + ' for ' + span

/**
 * A hand-driven clock: the mod's $.clock.now() returns whatever the test or a
 * stub last set. (mock.clock's advance() is meant to be called from the test,
 * not from inside a streaming stub, so it is not used here.)
 */
function fakeClock(on: any) {
  let now = 0
  on('clock.now', () => ({ value: now }))
  on('clock.every', () => ({ value: undefined }))
  return {
    advance(ms: number) {
      now += ms
    },
    set(ms: number) {
      now = ms
    },
  }
}

const usage = (output_tokens: number) => ({
  input_tokens: 10,
  output_tokens,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  model: 'claude-test',
})

/** Read a turn.step stream to its end and return its result. */
async function drain(stream: any) {
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()
  return step.value
}

/**
 * Stub a model response: `ttft` ms of waiting, `think` ms of thinking,
 * then `write` ms of visible output producing `tokens` output tokens.
 */
function stubResponse(on: any, clock: any, ttft: number, think: number, write: number, tokens: number, tool = false) {
  on('turn.step', async function* ($: any, e: any) {
    clock.advance(ttft)
    // Engine chunks (envelope, block start) can't be faked in tests, so the
    // first chunk here is the thinking text itself.
    if (think > 0) {
      yield { kind: 'thinking', index: 0, text: 'let me see' }
      clock.advance(think)
    }
    if (tool) {
      yield { kind: 'tool', index: 1, id: 'toolu_1', name: 'Read' }
      yield { kind: 'input', index: 1, json: '{"file_path":"a.txt"}' }
    } else {
      yield { kind: 'text', index: 1, text: 'hello' }
    }
    clock.advance(write)
    const stopReason = tool ? 'tool_use' : 'end_turn'
    yield { kind: 'stop', stopReason, usage: usage(tokens) }
    return {
      turnId: e.turnId,
      index: e.index,
      answer: tool ? '' : 'hello',
      toolUses: tool ? [{ name: 'Read', input: { file_path: 'a.txt' } }] : [],
      stopReason,
      usage: usage(tokens),
    }
  })
}

const complete = (turnId: string, extra: object = {}) => ({
  turnId,
  answer: 'hello',
  durationMs: 1,
  isAborted: false,
  reason: 'answer',
  usage: null,
  ...extra,
})

/**
 * Draws an assistant text block and returns the text the engine was handed:
 * the block as is, or with the mod's line beneath it.
 */
function drawer(on: any) {
  let handed = ''
  on('ui.render', ($: any, e: any) => {
    handed = e.props.text
    return { type: 'Text', props: {}, children: [e.props.text] }
  })
  return async ($: any, text: string) => {
    const view = await $.ui.mount({
      plugin: 'think-meter',
      component: 'AssistantMessage',
      requestId: 'msg_1',
      surface: 'desktop',
      viewport: { columns: 100, rows: 30 },
      props: { text, isFirstOfReply: true },
    })
    await view.unmount()
    return handed
  }
}

/** A block with a line under it, as the mod hands it on. */
const under = (text: string, line: string) => text + '\n\n*' + line + '*'

test('draws thinking time and tok/s under the answer, not as a notice', async ($, on) => {
  const clock = fakeClock(on)
  const draw = drawer(on)
  stubResponse(on, clock, 300, 3000, 1000, 400)
  on('turn.complete', () => ({ text: '' }))

  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-test', messageCount: 1 }))
  const out = await $.turn.complete(complete('t1'))

  // Nothing for the desktop app to fold into a "Claude Code notice"
  expect(out.text).toBe('')
  // wait 0 -> 300 (under 1 s, left off); thinking 300 -> 3300 (first text); writing 3300 -> 4300
  // 400 tokens over 4 s of streaming
  expect(await draw($, 'hello')).toBe(under('hello', opens('t1', '4.3s') + ' · thinking 3.0s · 100 tok/s'))
})

test('leaves other text blocks alone', async ($, on) => {
  const clock = fakeClock(on)
  const draw = drawer(on)
  stubResponse(on, clock, 100, 1000, 1000, 100)
  on('turn.complete', () => ({ text: '' }))

  await drain($.turn.step({ turnId: 'ta', index: 0, model: 'claude-test', messageCount: 1 }))
  await $.turn.complete(complete('ta', { answer: 'Let me look.\n\nAll done.' }))

  expect(await draw($, 'Something else')).toBe('Something else')
  // The last block of the answer gets the line; an earlier one does not
  expect(await draw($, 'All done.')).toBe(under('All done.', opens('ta', '2.1s') + ' · thinking 1.0s · 50 tok/s'))
  expect(await draw($, 'Let me look.')).toBe('Let me look.')
})

test('a repeated short reply gets the latest turn\'s line', async ($, on) => {
  const clock = fakeClock(on)
  const draw = drawer(on)
  stubResponse(on, clock, 100, 1000, 1000, 100)
  on('turn.complete', () => ({ text: '' }))

  await drain($.turn.step({ turnId: 'r1', index: 0, model: 'claude-test', messageCount: 1 }))
  await $.turn.complete(complete('r1', { answer: 'Done.' }))
  await drain($.turn.step({ turnId: 'r2', index: 0, model: 'claude-test', messageCount: 3 }))
  await $.turn.complete(complete('r2', { answer: 'Done.', durationMs: 9000 }))

  expect(await draw($, 'Done.')).toBe(under('Done.', opens('r2', '9.0s') + ' · thinking 1.0s · 50 tok/s'))
})

test('times a turn with tool calls; the split is in /think-stats', async ($, on) => {
  const clock = fakeClock(on)
  const draw = drawer(on)
  stubResponse(on, clock, 500, 2000, 1000, 350)
  // A tool that takes 6 s; the model's arguments and the result are none of the mod's business
  on('tool.call', () => {
    clock.advance(6000)
    return { deny: 'stubbed' }
  })
  on('turn.complete', () => ({ text: '' }))

  await drain($.turn.step({ turnId: 'tt', index: 0, model: 'claude-test', messageCount: 1 }))
  await $.tool.call({ tool: 'Read', file_path: 'a.txt' })
  await drain($.turn.step({ turnId: 'tt', index: 1, model: 'claude-test', messageCount: 3 }))
  // The engine reports the whole turn; 2 s of it is nothing the mod measured
  await $.turn.complete(complete('tt', { durationMs: 15000 }))

  expect(await draw($, 'hello')).toBe(under('hello', opens('tt', '15s') + ' · thinking 4.0s · 117 tok/s'))
  const stats = await $.command.run({ command: 'think-stats', args: '' })
  expect(stats.text).toContain('thinking 4.0s · writing 2.0s · tools 6.0s · waiting 1.0s · other 2.0s')
})

test('tool calls in a subagent are not counted as the main turn\'s tools', async ($, on) => {
  const clock = fakeClock(on)
  stubResponse(on, clock, 100, 1000, 1000, 100)
  on('tool.call', () => {
    clock.advance(4000)
    return { deny: 'stubbed' }
  })
  on('turn.complete', () => ({ text: '' }))

  await drain($.turn.step({ turnId: 'tm', index: 0, model: 'claude-test', messageCount: 1 }))
  await $.tool.call({ tool: 'Read', file_path: 'a.txt', agentId: 'agent-1' })
  await $.turn.complete(complete('tm'))
  const stats = await $.command.run({ command: 'think-stats', args: '' })
  expect(stats.text).not.toContain('tools')
})

test('sums every request of a turn with tool calls', async ($, on) => {
  const clock = fakeClock(on)
  const draw = drawer(on)
  let call = 0
  on('turn.step', async function* ($: any, e: any) {
    call += 1
    const isTool = call === 1
    clock.advance(200)
    yield { kind: 'thinking', index: 0, text: 'hmm' }
    clock.advance(1000)
    yield isTool ? { kind: 'tool', index: 1, id: 'toolu_1', name: 'Read' } : { kind: 'text', index: 1, text: 'done' }
    clock.advance(1000)
    return {
      turnId: e.turnId,
      index: e.index,
      answer: isTool ? '' : 'done',
      toolUses: [],
      stopReason: isTool ? 'tool_use' : 'end_turn',
      usage: usage(100),
    }
  })
  on('turn.complete', () => ({ text: '' }))

  await drain($.turn.step({ turnId: 't2', index: 0, model: 'claude-test', messageCount: 1 }))
  await drain($.turn.step({ turnId: 't2', index: 1, model: 'claude-test', messageCount: 3 }))
  await $.turn.complete(complete('t2', { answer: 'done' }))

  expect(await draw($, 'done')).toBe(under('done', opens('t2', '4.4s') + ' · thinking 2.0s · 50 tok/s'))
})

test('leaves subagent requests out of the main turn', async ($, on) => {
  const clock = fakeClock(on)
  const draw = drawer(on)
  stubResponse(on, clock, 100, 1000, 1000, 200)
  on('turn.complete', () => ({ text: '' }))

  await drain($.turn.step({ turnId: 'sub', index: 0, model: 'claude-test', messageCount: 1, agentId: 'agent-1' }))
  await $.turn.complete(complete('sub', { agentId: 'agent-1' }))
  expect(await draw($, 'hello')).toBe('hello')

  const stats = await $.command.run({ command: 'think-stats', args: '' })
  expect(stats.text).toBe('No turns measured yet in this session.')
})

test('passes on a line another mod added', async ($, on) => {
  const clock = fakeClock(on)
  stubResponse(on, clock, 100, 1000, 1000, 100)
  on('turn.complete', () => ({ text: 'from another mod' }))

  await drain($.turn.step({ turnId: 't3', index: 0, model: 'claude-test', messageCount: 1 }))
  const out = await $.turn.complete(complete('t3'))
  expect(out.text).toBe('from another mod')
})

test('marks an interrupted turn', async ($, on) => {
  const clock = fakeClock(on)
  const draw = drawer(on)
  stubResponse(on, clock, 100, 1000, 1000, 100)
  on('turn.complete', () => ({ text: '' }))

  await drain($.turn.step({ turnId: 't4', index: 0, model: 'claude-test', messageCount: 1 }))
  await $.turn.complete(complete('t4', { isAborted: true, reason: 'aborted' }))
  expect(await draw($, 'hello')).toBe(under('hello', '✻ Interrupted after 2.1s · thinking 1.0s · 50 tok/s'))
})

test('/think-stats summarises the session', async ($, on) => {
  const clock = fakeClock(on)
  stubResponse(on, clock, 500, 2000, 2000, 400)
  on('turn.complete', () => ({ text: '' }))

  await drain($.turn.step({ turnId: 't5', index: 0, model: 'claude-test', messageCount: 1 }))
  await $.turn.complete(complete('t5'))
  const stats = await $.command.run({ command: 'think-stats', args: '' })

  expect(stats.text).toContain('✻ 1 turn · 4.5s in all · 4.5s median')
  // waiting (0.5 s) is under a second, so it is left out like on the line
  expect(stats.text).toContain('\nthinking 2.0s · writing 2.0s\n')
  expect(stats.text).toContain('claude-test · 1 request · 400 output tok · 100 tok/s · 0.5s median wait')
})

// Note: the test kit runs one dispatch at a time, so it can't draw the spinner
// while a turn.step stream is still open. The live timer's text is unit-tested
// through liveSuffix() in meter.test.ts; check the live behaviour by hand in a
// session (see CONTRIBUTING.md).
test('the spinner is left alone when Claude is not thinking', async ($, on) => {
  const clock = fakeClock(on)
  stubResponse(on, clock, 100, 2500, 500, 100)
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($: any, e: any) => ({
    type: 'Text',
    props: {},
    children: [e.props.word + e.props.suffix],
  }))
  const spinner = {
    plugin: 'think-meter',
    component: 'Spinner',
    requestId: 'main',
    surface: 'terminal',
    viewport: { columns: 100, rows: 30 },
    props: { word: 'Pondering', message: null, suffix: '…', mode: 'responding' },
  }

  const idle = await $.ui.mount(spinner)
  expect(await idle.find({ type: 'Text', text: 'Pondering…' })).toBeDefined()
  await idle.unmount()

  // After a full response the timer has stopped, so the spinner is untouched again
  await drain($.turn.step({ turnId: 't6', index: 0, model: 'claude-test', messageCount: 1 }))
  const after = await $.ui.mount(spinner)
  expect(await after.find({ type: 'Text', text: 'Pondering…' })).toBeDefined()
  await after.unmount()
})
