/** 语音听写（Web Speech API）。
 *
 * 浏览器限制：语音识别只在「安全上下文」可用——电脑上用 localhost/127.0.0.1 打开正常；
 * 手机经局域网 IP（http://192.168.x.x）访问时被浏览器禁用，此时只能打字。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

interface SRAlternative {
  transcript: string
}

interface SRResult {
  isFinal: boolean
  0: SRAlternative
}

interface SREvent {
  resultIndex: number
  results: { length: number; [i: number]: SRResult }
}

interface SRErrorEvent {
  error?: string
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((e: SREvent) => void) | null
  onerror: ((e: SRErrorEvent) => void) | null
  onend: (() => void) | null
}

type SRCtor = new () => SpeechRecognitionLike

function getCtor(): SRCtor | null {
  const w = window as unknown as Record<string, SRCtor | undefined>
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function useDictation(onFinalText: (text: string) => void) {
  const [supported] = useState(() => getCtor() !== null)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const cbRef = useRef(onFinalText)

  useEffect(() => {
    cbRef.current = onFinalText
  }, [onFinalText])

  useEffect(() => {
    return () => {
      try {
        recRef.current?.stop()
      } catch {
        /* 忽略停止异常 */
      }
    }
  }, [])

  const start = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor) return
    try {
      recRef.current?.stop()
    } catch {
      /* 忽略 */
    }
    const rec = new Ctor()
    rec.lang = 'zh-CN'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let finalText = ''
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else interimText += r[0].transcript
      }
      if (finalText) cbRef.current(finalText)
      setInterim(interimText)
    }
    rec.onerror = (e) => {
      const code = e?.error ?? ''
      if (code === 'not-allowed' || code === 'service-not-allowed')
        setError('麦克风权限被拒绝：请点击地址栏的锁/麦克风图标允许后重试')
      else if (code === 'no-speech') setError('没听到声音，请靠近麦克风再试')
      else if (code === 'network') setError('语音服务连接失败：建议换 Edge 浏览器重试')
      else setError(`语音识别出错：${code || '未知错误'}`)
      setListening(false)
    }
    rec.onend = () => setListening(false)
    recRef.current = rec
    setError(null)
    setInterim('')
    try {
      rec.start()
      setListening(true)
    } catch {
      setListening(false)
      setError('无法启动语音识别，请刷新页面重试')
    }
  }, [])

  const stop = useCallback(() => {
    try {
      recRef.current?.stop()
    } catch {
      /* 忽略 */
    }
    setListening(false)
    setInterim('')
  }, [])

  return { supported, listening, interim, error, start, stop }
}
