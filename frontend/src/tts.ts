/** 语音播报（v2.3-1 分句队列引擎）。
 *
 * 仅 edge-tts（POST /api/tts）→ mp3 播放；合成失败不回退，显示「语音暂时不可用，点击重试」。
 * 队列模型：speak/enqueue 把句子压入 FIFO，泵循环逐句「合成→播放→下一句」——
 * 流式面试官回复可边生成边入队（分句即译），点读气泡整段一次入队。
 * playingTag 标记当前播放单元（气泡高亮用），playingText 为当前正在播的句子；
 * tokenRef 递增作废整条播放链路防竞态（切句/停止/重入）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { attachTtsAudio } from './audio-bus'

const ENABLED_KEY = 'ai_interviewer_tts_enabled'
const RATE_KEY = 'ai_interviewer_tts_rate'

interface QueueItem {
  text: string
  tag: string
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'off'
  } catch {
    return true
  }
}

function readRate(): number {
  try {
    const v = Number(localStorage.getItem(RATE_KEY))
    return Number.isFinite(v) && v >= 0.5 && v <= 2 ? v : 1
  } catch {
    return 1
  }
}

/** 按中文句读切句（保留句末标点），供整段播报与流式缓冲共用。 */
export function splitSentences(text: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const ch of (text || '').trim()) {
    cur += ch
    if ('。！？；!?;…\n'.includes(ch) && cur.trim()) {
      out.push(cur.trim())
      cur = ''
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** 流式增量分句缓冲：push(delta) 吐出已完结的句子，flush() 吐出残余。 */
export class SentenceBuffer {
  private buf = ''
  private readonly emit: (sentence: string) => void
  constructor(emit: (sentence: string) => void) {
    this.emit = emit
  }

  push(delta: string) {
    this.buf += delta
    const parts = this.buf.split(/(?<=[。！？；!?;…\n])/)
    this.buf = parts.pop() ?? ''
    for (const p of parts) if (p.trim()) this.emit(p.trim())
  }

  flush() {
    if (this.buf.trim()) {
      this.emit(this.buf.trim())
      this.buf = ''
    }
  }
}

export function useSpeaker() {
  const supported = typeof window !== 'undefined' && typeof Audio !== 'undefined'
  const [enabled, setEnabled] = useState(readEnabled)
  const [rate, setRate] = useState(readRate)
  const [speaking, setSpeaking] = useState(false)
  const [playingText, setPlayingText] = useState<string | null>(null)
  const [playingTag, setPlayingTag] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const tokenRef = useRef(0)
  const queueRef = useRef<QueueItem[]>([])
  const pumpingRef = useRef(false)
  const lastUnitRef = useRef<{ text: string; tag: string } | null>(null)
  const rateRef = useRef(rate)
  /** 当前播放 Promise 的 resolve（停止/切句时主动结算，防止泵循环永久卡在 await） */
  const settleRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    rateRef.current = rate
  }, [rate])

  useEffect(() => {
    try {
      localStorage.setItem(ENABLED_KEY, enabled ? 'on' : 'off')
    } catch {
      /* 忽略 */
    }
  }, [enabled])
  useEffect(() => {
    try {
      localStorage.setItem(RATE_KEY, String(rate))
    } catch {
      /* 忽略 */
    }
  }, [rate])

  const cleanupAudio = useCallback(() => {
    // 先结算正在等待的播放 Promise：pause() 不触发 ended，摘掉 onended 会让泵循环
    // 永久卡在 await（pumpingRef 不释放 → 后续所有 speak 静默失效）。
    settleRef.current?.()
    settleRef.current = null
    if (audioRef.current) {
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current.pause()
      audioRef.current = null
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      tokenRef.current++
      cleanupAudio()
    }
  }, [cleanupAudio])

  const stop = useCallback(() => {
    tokenRef.current++
    queueRef.current = []
    cleanupAudio()
    setSpeaking(false)
    setPlayingText(null)
    setPlayingTag(null)
  }, [cleanupAudio])

  const pump = useCallback(async () => {
    if (pumpingRef.current) return
    pumpingRef.current = true
    const token = tokenRef.current
    try {
      while (queueRef.current.length) {
        if (token !== tokenRef.current) return
        const item = queueRef.current.shift()!
        setSpeaking(true)
        setPlayingText(item.text)
        setPlayingTag(item.tag)
        try {
          const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: item.text, rate: rateRef.current }),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const blob = await res.blob()
          if (token !== tokenRef.current) return
          const url = URL.createObjectURL(blob)
          urlRef.current = url
          const audio = new Audio(url)
          audioRef.current = audio
          attachTtsAudio(audio) // B1：接入分析总线（声音改走 Web Audio 图，可听性不变）
          let playErr = false
          await new Promise<void>((resolve) => {
            settleRef.current = resolve
            audio.onended = () => resolve()
            audio.onerror = () => {
              playErr = true
              resolve()
            }
            void audio.play().catch(() => {
              playErr = true
              resolve()
            })
          })
          settleRef.current = null
          if (token !== tokenRef.current) return
          if (playErr) throw new Error('play failed')
          cleanupAudio()
        } catch {
          if (token !== tokenRef.current) return
          cleanupAudio()
          queueRef.current = [] // 失败即弃队：避免后续句子无限卡顿
          setFailed(true)
          setSpeaking(false)
          setPlayingText(null)
          setPlayingTag(null)
          return
        }
      }
      if (token === tokenRef.current) {
        setSpeaking(false)
        setPlayingText(null)
        setPlayingTag(null)
      }
    } finally {
      pumpingRef.current = false
      // 流式期间泵完可能又有新句入队，续泵；
      // 旧链路被 stop/speak 作废时队列可能已被新一次 speak 填好，也必须接续（不判 token）。
      if (queueRef.current.length) void pump()
    }
  }, [cleanupAudio])

  /** 整段播报（点读气泡）：清队后整段切句入队。 */
  const speak = useCallback(
    (text: string, tag = 'manual') => {
      const clean = (text || '').trim()
      if (!clean || !enabled) return
      tokenRef.current++
      queueRef.current = []
      cleanupAudio()
      lastUnitRef.current = { text: clean, tag }
      setFailed(false)
      for (const s of splitSentences(clean)) queueRef.current.push({ text: s, tag })
      void pump()
    },
    [enabled, cleanupAudio, pump],
  )

  /** 追加已完结的句子（流式分句即译用），与 speak 同 tag 时排队续播。 */
  const enqueue = useCallback(
    (sentence: string, tag: string) => {
      const clean = (sentence || '').trim()
      if (!clean || !enabled) return
      queueRef.current.push({ text: clean, tag })
      setFailed(false)
      void pump()
    },
    [enabled, pump],
  )

  const retry = useCallback(() => {
    if (lastUnitRef.current) speak(lastUnitRef.current.text, lastUnitRef.current.tag)
  }, [speak])

  return {
    supported,
    enabled,
    setEnabled,
    rate,
    setRate,
    speaking,
    playingText,
    playingTag,
    failed,
    speak,
    enqueue,
    stop,
    retry,
  }
}
