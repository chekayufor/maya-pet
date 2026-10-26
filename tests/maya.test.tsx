import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'maya',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 60,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('Maya waves, then rests, on every graphical surface; the terminal keeps its band', async ($, on) => {
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'maya' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const svg = await ui.find({ type: 'Svg' })
    expect(svg?.type).toBe('Svg')
    expect(String(svg?.props.alt)).toContain('Привет')
    expect(String(svg?.props.source)).toContain('repeatCount="1"')
    // The desktop app shows an embedded picture only as PNG in a plain (non-interactive) Svg.
    expect(String(svg?.props.source)).toContain('data:image/png;base64,')
    expect(svg?.props.isInteractive).toBeUndefined()
    expect(String(svg?.props.source).length).toBeLessThan(131072)
    await ui.unmount()
  }

  await clock.advance(2_000)
  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toContain('рядом')
  await desk.unmount()

  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await term.unmount()
})

test('/maya hides her and brings her back', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'maya' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const hidden = await $.command.run({ command: 'maya', args: '' })
  expect(hidden.text).toContain('спряталась')
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()

  const back = await $.command.run({ command: 'maya', args: '' })
  expect(back.text).toContain('снова')
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Svg' }))?.type).toBe('Svg')
  await ui.unmount()
})

test('a failing tool call makes her say whoops', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'maya' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: 'boom', isError: true }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'false' })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('Ой')
  await ui.unmount()
})
