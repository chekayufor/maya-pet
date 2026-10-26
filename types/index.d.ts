export type MayaAnim = 'idle' | 'waving' | 'jumping' | 'failed' | 'waiting' | 'running' | 'review' | 'look'

/** What Maya is showing now; `seq` changes on every switch so a one-shot replays. */
export type MayaPose = { anim: MayaAnim; isOnce: boolean; seq: number }

/** The language Maya speaks: the one the person last wrote in. */
export type MayaLang = 'en' | 'ru' | 'he'

declare module 'claude-code' {
  interface PluginState {
    maya: { pose: MayaPose; isHidden: boolean; lang: MayaLang }
  }
}
