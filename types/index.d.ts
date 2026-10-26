export type MayaAnim = 'idle' | 'waving' | 'jumping' | 'failed' | 'waiting' | 'running' | 'review' | 'look'

/** What Maya is showing now; `seq` changes on every switch so a one-shot replays. */
export type MayaPose = { anim: MayaAnim; isOnce: boolean; seq: number }

declare module 'claude-code' {
  interface PluginState {
    maya: { pose: MayaPose; isHidden: boolean }
  }
}
