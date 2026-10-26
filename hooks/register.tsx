import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { MayaAnim, MayaLang, MayaPose } from '../types'
import { FRAME_H, FRAME_W, STRIPS } from './frames'

const pose = atom({ plugin: 'maya', key: 'pose' } as const, { anim: 'idle', isOnce: false, seq: 0 })
const isHidden = atom({ plugin: 'maya', key: 'isHidden' } as const, false)
const lang = atom({ plugin: 'maya', key: 'lang' } as const, 'en')

const CAPTIONS: Record<MayaLang, Record<MayaAnim, string>> = {
  en: {
    idle: 'Maya is here',
    waving: 'Hi!',
    jumping: 'Yay, a task!',
    running: 'Maya is thinking…',
    waiting: 'Maya is waiting for your answer',
    failed: 'Oops!',
    review: 'Done! Maya is checking',
    look: 'Maya is looking around',
  },
  ru: {
    idle: 'Майя рядом',
    waving: 'Привет!',
    jumping: 'Ура, задание!',
    running: 'Майя думает…',
    waiting: 'Майя ждёт твоего ответа',
    failed: 'Ой!',
    review: 'Готово! Майя проверяет',
    look: 'Майя оглядывается',
  },
  he: {
    idle: 'מאיה כאן',
    waving: 'שלום!',
    jumping: 'יש, משימה!',
    running: 'מאיה חושבת…',
    waiting: 'מאיה מחכה לתשובה שלך',
    failed: 'אופס!',
    review: 'מוכן! מאיה בודקת',
    look: 'מאיה מסתכלת מסביב',
  },
}
const NAME: Record<MayaLang, string> = { en: 'Maya', ru: 'Майя', he: 'מאיה' }
const HIDDEN: Record<MayaLang, string> = {
  en: 'Maya is hiding. /maya brings her back.',
  ru: 'Майя спряталась. /maya вернёт её.',
  he: 'מאיה התחבאה. ‎/maya‏ תחזיר אותה.',
}
const BACK: Record<MayaLang, string> = { en: 'Maya is back!', ru: 'Майя снова здесь!', he: 'מאיה חזרה!' }

// Tools that stop and wait for the person.
const ASKS = new Set(['AskUserQuestion', 'ExitPlanMode'])
const IDLE_LOOK_AFTER_MS = 20_000
// The desktop app's loader word while it has no step to name.
const IDLE_WORDS = new Set(['Working', ''])

const lengthOf = (anim: MayaAnim) => STRIPS[anim].durations.reduce((sum: number, d: number) => sum + d, 0)

/** The language a message is written in, by its letters; undefined when it shows none of them. */
export function langOf(text: string): MayaLang | undefined {
  const hebrew = (text.match(/[֐-׿]/g) ?? []).length
  const cyrillic = (text.match(/[Ѐ-ӿ]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  const most = Math.max(hebrew, cyrillic, latin)
  if (most === 0) return undefined
  if (most === hebrew) return 'he'
  if (most === cyrillic) return 'ru'

  return 'en'
}

/**
 * One SVG per pose: the state's PNG frame strip, stepped by a discrete SMIL animation,
 * drawn `width` CSS pixels wide.
 *
 * Drawn as a plain image (no `isInteractive`): the desktop app shows an embedded
 * PNG that way, and not in the sandboxed frame or as WebP.
 */
export function svgFor(p: MayaPose, width: number = FRAME_W / 2): string {
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
  const height = Math.round((width * FRAME_H) / FRAME_W)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" id="maya-${p.seq}" viewBox="0 0 ${FRAME_W} ${FRAME_H}" ` +
    `width="${width}" height="${height}"><desc>${p.anim} ${p.seq}</desc>` +
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

// Follows the language of what the person wrote, and remembers it for the next chat.
async function hear($: EngineInterface, text: string) {
  const heard = langOf(text)
  if (heard === undefined || heard === (await read($, lang))) return
  await update($, lang, () => heard)
  await $.store.set('lang', heard)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'maya', description: 'Show or hide Maya · Показать или спрятать Майю · הצג או הסתר את מאיה' })
    const saved = await $.store.get('lang')
    if (saved === 'en' || saved === 'ru' || saved === 'he') await update($, lang, () => saved)
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
    const l = await read($, lang)

    return { text: hidden ? HIDDEN[l] : BACK[l] }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      isBusy = true
      await hear($, e.text)
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

  // Maya above the prompt; on the desktop she moves into the loader while a turn runs.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isInLoader = e.surface === 'desktop' && e.props.isWorking
    if (e.surface === 'terminal' || e.props.hasSurvey || isInLoader || (await read($, isHidden))) {
      return next(e)
    }
    const { Box, Svg, Text } = $.ui.resolve(e)
    const p = await read($, pose)
    const l = await read($, lang)
    const caption = CAPTIONS[l][p.anim]

    return (
      <Box flexDirection="row" alignItems="flex-end" gap={1}>
        <Svg source={svgFor(p)} alt={`${NAME[l]}: ${caption}`} width={FRAME_W / 2} height={FRAME_H / 2} />
        <Text dimColor dir={l === 'he' ? 'rtl' : 'ltr'}>{caption}</Text>
      </Box>
    )
  })

  // Claude's loader, drawn as Maya: her pose, her caption, and the step the turn is on.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || (await read($, isHidden))) {
      return next(e)
    }
    const { Box, Svg, Text } = $.ui.resolve(e)
    const p = await read($, pose)
    const l = await read($, lang)
    const caption = CAPTIONS[l][p.anim]
    const step = e.props.message ?? (IDLE_WORDS.has(e.props.word) ? undefined : e.props.word)
    const width = FRAME_W / 3

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Svg source={svgFor(p, width)} alt={`${NAME[l]}: ${caption}`} width={width} height={Math.round(FRAME_H / 3)} />
        <Box flexDirection="column">
          <Text dimColor dir={l === 'he' ? 'rtl' : 'ltr'}>{caption}</Text>
          {step !== undefined && <Text dimColor>{step}{e.props.suffix}</Text>}
        </Box>
      </Box>
    )
  })
}
