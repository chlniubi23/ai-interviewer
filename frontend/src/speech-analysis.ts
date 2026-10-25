/** 表达分析（v2.3-1）：STT 文本本地统计——语速 / 填充词 / 句完整度。零 API 成本。
 *
 * 语速：去标点字数 / 作答时长（中文口述参考 160-280 字/分）；
 * 填充词：嗯/啊/呃/然后/就是/那个 直接计数（高频出现即口头禅信号）；
 * 句完整度：以句末标点收尾且 ≥3 字的句子占比（碎片化表达检测）。
 */
export interface SpeechStat {
  chars: number
  durationSec: number
  /** 字/分 */
  rate: number
  fillers: { word: string; count: number }[]
  fillerTotal: number
  sentences: number
  /** 0-1 */
  completeRate: number
}

export type Level = 'good' | 'mid' | 'low'

const FILLER_WORDS = ['嗯', '啊', '呃', '然后', '就是', '那个']

function countWord(text: string, word: string): number {
  if (!word) return 0
  let n = 0
  let i = text.indexOf(word)
  while (i !== -1) {
    n++
    i = text.indexOf(word, i + word.length)
  }
  return n
}

/** 时长过短或字数过少时返回 null（不打扰短回答，不入库）。
 * 语速只在作答 ≥10s 时计算——打字作答/极短口述的"语速"没有参考意义。 */
export function analyzeSpeech(text: string, durationSec: number): SpeechStat | null {
  const clean = (text || '').trim()
  if (clean.length < 10 || durationSec < 3) return null
  const chars = clean.replace(/[\s，。！？；、,.!?;:「」『』（）()…—-]/g, '').length
  const dur = Math.max(1, durationSec)
  const rate = durationSec >= 10 ? Math.round((chars / dur) * 60) : 0
  const fillers = FILLER_WORDS.map((w) => ({ word: w, count: countWord(clean, w) })).filter(
    (f) => f.count > 0,
  )
  const fillerTotal = fillers.reduce((a, b) => a + b.count, 0)
  const parts = clean
    .split(/(?<=[。！？!?；;\n])/)
    .map((s) => s.trim())
    .filter(Boolean)
  const sentences = parts.length || 1
  const complete = parts.filter(
    (s) => /[。！？!?；;]/.test(s.slice(-1)) && s.replace(/\s/g, '').length >= 3,
  ).length
  return {
    chars,
    durationSec,
    rate,
    fillers,
    fillerTotal,
    sentences,
    completeRate: parts.length ? complete / parts.length : 0,
  }
}

export function rateLevel(rate: number): { label: string; cls: Level } {
  if (rate >= 160 && rate <= 280) return { label: '适中', cls: 'good' }
  if (rate >= 120 && rate <= 330) return { label: '可接受', cls: 'mid' }
  return { label: rate < 120 ? '偏慢' : '偏快', cls: 'low' }
}

export function fillerLevel(fillerTotal: number, chars: number): { label: string; cls: Level } {
  const per100 = chars > 0 ? (fillerTotal * 100) / chars : 0
  if (per100 < 2) return { label: '干净', cls: 'good' }
  if (per100 < 5) return { label: '偏多', cls: 'mid' }
  return { label: '口头禅', cls: 'low' }
}

export function completeLevel(completeRate: number): { label: string; cls: Level } {
  if (completeRate >= 0.8) return { label: '完整', cls: 'good' }
  if (completeRate >= 0.5) return { label: '一般', cls: 'mid' }
  return { label: '碎片化', cls: 'low' }
}

/** 存进候选人消息 meta.speech 的精简结构（报告表达维度用）。 */
export interface SpeechMeta {
  duration_sec?: number
  rate?: number
  fillers?: number
  complete?: number
}

export function toSpeechMeta(stat: SpeechStat): SpeechMeta {
  return {
    duration_sec: stat.durationSec,
    rate: stat.rate,
    fillers: stat.fillerTotal,
    complete: Math.round(stat.completeRate * 100) / 100,
  }
}
