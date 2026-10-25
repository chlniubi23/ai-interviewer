import { useEffect, useRef } from 'react'
import AutoTextarea from './AutoTextarea'
import { useDictation } from '../speech'

/** 作答输入框：语音听写 + 手动修改，确认提交由外层按钮完成（面试页/题库页共用）。
 * muted：面试官 TTS 播报期间为 true——自动停止听写并禁用麦克风（防自听）。
 * v2.3.1-2：输入体换 AutoTextarea（自动增高 + 约 40 字/行折行）。 */
export default function AnswerInput(props: {
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
  disabled?: boolean
  muted?: boolean
  /** 麦克风监听状态变化（v2.3-1 面试间波形联动用，页面视图不传） */
  onListeningChange?: (listening: boolean) => void
}) {
  const { value, onChange, rows = 4, placeholder, disabled, muted, onListeningChange } = props
  // 缓冲最新文本：连续多段语音识别结果之间可能来不及重渲染，防止丢字
  const pendingRef = useRef(value)
  useEffect(() => {
    pendingRef.current = value
  }, [value])
  const { supported, listening, interim, error, start, stop } = useDictation((t) => {
    const next = pendingRef.current + t
    pendingRef.current = next
    onChange(next)
  })

  useEffect(() => {
    onListeningChange?.(listening)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening])

  // 互斥：提交中（disabled）或面试官播报中（muted）时，立即停麦
  useEffect(() => {
    if ((disabled || muted) && listening) stop()
  }, [disabled, muted, listening, stop])

  return (
    <div className="answer-input">
      <AutoTextarea
        value={value}
        onChange={(v) => {
          pendingRef.current = v
          onChange(v)
        }}
        minRows={rows}
        maxRows={10}
        maxWidthChars={40}
        placeholder={placeholder}
        disabled={disabled}
      />
      <div className="mic-row">
        {supported ? (
          <button
            type="button"
            className={`btn small mic-btn${listening ? ' rec' : ''}`}
            onClick={listening ? stop : start}
            disabled={disabled || muted}
          >
            {muted ? '🔇 面试官播报中' : listening ? '■ 停止录音' : '🎤 语音作答'}
          </button>
        ) : (
          <span className="muted mic-hint">此浏览器不支持语音识别：请在电脑上用 Edge/Chrome 打开本页使用语音（手机端受安全限制只能打字）</span>
        )}
        {muted && <span className="muted">麦克风已暂停，防止录进面试官的声音</span>}
        {!muted && listening && <span className="muted">{interim || '正在听…说完点「停止录音」，修改后提交'}</span>}
      </div>
      {error && <p className="msg error">{error}</p>}
    </div>
  )
}
