import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { MayaAnim, MayaPose } from '../types'
import { FRAME_H, FRAME_W, STRIPS } from './frames'

const pose = atom({ plugin: 'maya', key: 'pose' } as const, { anim: 'idle', isOnce: false, seq: 0 })
const isHidden = atom({ plugin: 'maya', key: 'isHidden' } as const, false)

const CAPTIONS: Record<MayaAnim, string> = {
  idle: 'Майя рядом',
  waving: 'Привет!',
  jumping: 'Ура, задание!',
  running: 'Майя думает…',
  waiting: 'Майя ждёт твоего ответа',
  failed: 'Ой!',
  review: 'Готово! Майя проверяет',
  look: 'Майя оглядывается',
}
// Tools that stop and wait for the person.
const ASKS = new Set(['AskUserQuestion', 'ExitPlanMode'])
const IDLE_LOOK_AFTER_MS = 20_000

const lengthOf = (anim: MayaAnim) => STRIPS[anim].durations.reduce((sum: number, d: number) => sum + d, 0)

/**
 * One SVG per pose: the state's PNG frame strip, stepped by a discrete SMIL animation.
 *
 * Drawn as a plain image (no `isInteractive`): the desktop app shows an embedded
 * PNG that way, and not in the sandboxed frame or as WebP.
 */
export function svgFor(p: MayaPose): string {
  const strip = STRIPS[p.anim]
  const total = lengthOf(p.anim)
  const keyTimes: string[] = []
  const values: number[] = []
  let at = 0
  strip.durations.forEach((d: number, i: number) => {
    keyTimes.push((at / total).toFixed(4))
    values.push(-i * FRAME_W)
    at += d
  })
  const repeat = p.isOnce ? 'repeatCount="1" fill="freeze"' : 'repeatCount="indefinite"'

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" id="maya-${p.seq}" viewBox="0 0 ${FRAME_W} ${FRAME_H}" ` +
    `width="${FRAME_W / 2}" height="${FRAME_H / 2}"><desc>${p.anim} ${p.seq}</desc>` +
    `<image x="0" y="0" width="${FRAME_W * strip.frames}" height="${FRAME_H}" href="${strip.href}">` +
    `<animate attributeName="x" calcMode="discrete" values="${values.join(';')}" ` +
    `keyTimes="${keyTimes.join(';')}" dur="${total}ms" ${repeat}/></image></svg>`
  )
}

let timer: Timer | undefined
let isBusy = false
let lastActivity = 0

function rest(): MayaAnim {
  return isBusy ? 'running' : 'idle'
}

// Shows `anim`; with `then`, plays it once and moves on to `then` afterwards.
async function show($: EngineInterface, anim: MayaAnim, then?: MayaAnim | (() => MayaAnim)) {
  timer?.cancel()
  timer = undefined
  lastActivity = await $.clock.now()
  await update($, pose, p => ({ anim, isOnce: then !== undefined, seq: p.seq + 1 }))
  if (then !== undefined) {
    timer = $.clock.after(lengthOf(anim), () => {
      void show($, typeof then === 'function' ? then() : then)
    })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'maya', description: 'Показать или спрятать Майю' })
    await show($, 'waving', rest)
    $.clock.every(5_000, async () => {
      const now = await $.clock.now()
      const current = await read($, pose)
      if (!isBusy && timer === undefined && current.anim === 'idle' && now - lastActivity > IDLE_LOOK_AFTER_MS) {
        void show($, 'look', rest)
      }
    })

    return next(e)
  })

  on('command.run', { command: 'maya' }, async $ => {
    const hidden = await update($, isHidden, h => !h)
    if (!hidden) await show($, 'waving', rest)

    return { text: hidden ? 'Майя спряталась. /maya вернёт её.' : 'Майя снова здесь!' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      isBusy = true
      await (e.text === '' ? show($, 'running') : show($, 'jumping', rest))
    }

    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask') await show($, 'waiting')

    return verdict
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const isAsk = ASKS.has(String(e.tool))
    if (isAsk) await show($, 'waiting')
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError) {
      await show($, 'failed', rest)
    } else if (isAsk || (await read($, pose)).anim === 'waiting') {
      await show($, rest())
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isBusy = false
      await (e.reason === 'answer' ? show($, 'review', 'idle') : show($, 'failed', 'idle'))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'terminal' || e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }
    const { Box, Svg, Text } = $.ui.resolve(e)
    const p = await read($, pose)

    return (
      <Box flexDirection="row" alignItems="flex-end" gap={1}>
        <Svg source={svgFor(p)} alt={`Майя: ${CAPTIONS[p.anim]}`} width={FRAME_W / 2} height={FRAME_H / 2} />
        <Text dimColor>{CAPTIONS[p.anim]}</Text>
      </Box>
    )
  })
}
