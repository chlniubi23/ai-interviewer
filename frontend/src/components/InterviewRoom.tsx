/** 沉浸式面试间 → 面试驾驶舱（工作包 A 重构）：
 *
 * 三区布局（≥1200px）：左=话题树（280px 可折叠）/ 中=对话流+作答 / 右=实时分析栏（300px 可折叠）；
 * ≤1200px 右栏收起为悬浮按钮抽屉；≤720px 纵向堆叠。沉浸全屏属性保留。
 * 恒定深色氛围光（独立于浅/深主题）；AI 形象三态动效；麦克风/播报波形 canvas；
 * 面试计时器 + 进度。作答/提交/播报控制与页面视图共用同一套上层状态（SSE/TTS/互斥时序原样）。
 */
import { useEffect, useRef, useState } from 'react'
import { useSpeaker } from '../tts'
import { bubbleIn, motion, useReducedMotion } from '../motion'
import { audioBusAvailable, readTtsLevels } from '../audio-bus'
import type { SpeechStat } from '../speech-analysis'
import type { Msg } from '../interview-types'
import AnswerInput from './AnswerInput'
import SpeechStrip from './SpeechStrip'
import TopicTree from './cockpit/TopicTree'
import MetricsPanel from './cockpit/MetricsPanel'
import { useInterviewMetrics } from './cockpit/useInterviewMetrics'
import { useMediaQuery } from './cockpit/useMediaQuery'
import heroImg from '../assets/interviewer-hero.webp'

export interface RoomMsg {
  role: 'interviewer' | 'candidate'
  text: string
  meta?: {
    action?: string
    question_type?: string | null
    is_main_question?: boolean
    speech?: { duration_sec?: number; rate?: number; fillers?: number; complete?: number } | null
  } | null
}

const TRACK = ['自我介绍', '项目①', '项目②', '概念①', '概念②', '场景', '反问']
const FOCUSED_TRACK = ['弱项①', '弱项②', '弱项③', '弱项④']

function WaveCanvas({ mode }: { mode: 'mic' | 'voice' | 'idle' }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    let raf = 0
    let t = 0
    // B2：voice 模式画真实频谱（人声主能区 0-4kHz），帧间平滑；总线未就绪回退模拟
    const live = audioBusAvailable()
    const smooth = new Float32Array(48)
    const draw = () => {
      t += 0.085
      const w = cv.width
      const h = cv.height
      ctx.clearRect(0, 0, w, h)
      const bars = 48
      const gap = 3
      const bw = (w - gap * (bars - 1)) / bars
      const levels = live && mode === 'voice' ? readTtsLevels() : null
      for (let i = 0; i < bars; i++) {
        const center = 1 - Math.abs(i - bars / 2) / (bars / 2)
        let amp: number
        if (mode === 'voice' && levels?.freq) {
          const bin = Math.floor((i / bars) * 180)
          const target = Math.max(0.04, (levels.freq[bin] / 255) * (0.35 + 0.65 * center))
          smooth[i] += (target - smooth[i]) * 0.38
          amp = smooth[i]
        } else if (mode === 'idle') {
          amp = 0.07 + 0.04 * Math.sin(t + i * 0.4)
        } else if (mode === 'mic') {
          amp =
            (0.28 + 0.68 * Math.abs(Math.sin(t * 1.7 + i * 0.9) * Math.sin(t * 0.6 + i * 0.23))) *
            (0.35 + 0.65 * center)
        } else {
          amp = (0.22 + 0.5 * Math.abs(Math.sin(t * 0.9 + i * 0.35))) * (0.3 + 0.7 * center)
        }
        const bh = Math.max(3, amp * h)
        const x = i * (bw + gap)
        ctx.fillStyle =
          mode === 'mic' ? 'rgba(125,195,255,0.92)' : mode === 'voice' ? 'rgba(150,132,255,0.88)' : 'rgba(140,150,170,0.4)'
        ctx.beginPath()
        ctx.roundRect(x, (h - bh) / 2, bw, bh, 2)
        ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [mode])
  return <canvas ref={ref} width={520} height={44} className="room-wave" />
}

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function InterviewRoom(props: {
  direction: string
  createdAt: string | null
  mainCount: number
  nextType: string | null
  focused?: boolean
  /** 战役轮次标签（如「战役第1轮·HR面」）；专项训练不传 */
  roundLabel?: string
  /** v2.4 时长档（分钟）：时长驱动场显示剩余预算与时间进度条（替代固定题数轨道） */
  durationMin?: number | null
  done: boolean
  messages: RoomMsg[]
  stats: Record<number, SpeechStat>
  streamingText: string | null
  streamingMeta: { action: string; question_type: string | null; is_main_question: boolean } | null
  thinking: boolean
  reportStage: boolean
  speaker: ReturnType<typeof useSpeaker>
  answer: string
  onAnswerChange: (v: string) => void
  onSubmit: () => void
  onEnd: () => void
  onExit: () => void
  busy: 'answer' | 'end' | null
}) {
  const { speaker } = props
  const [elapsed, setElapsed] = useState(0)
  const [listening, setListening] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)
  // C4：面试官气泡逐条入场——进面试间前已有的消息不重放，仅新消息浮现
  const reducedMotion = useReducedMotion()
  const [msgMountLen] = useState(() => props.messages.length)
  // v2.4 剩余预算（秒，可为负=超时）；时长驱动场进度 = 已用/目标
  const durationSec = (props.durationMin ?? 0) * 60
  const remainingSec = durationSec ? durationSec - elapsed : 0
  const timeProgress = durationSec ? Math.min(100, (elapsed / durationSec) * 100) : 0
  const fmtSigned = (sec: number) => {
    const s = Math.abs(Math.round(sec))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  // ---- 工作包 A：驾驶舱三区状态 ----
  const narrowRight = useMediaQuery('(max-width: 1200px)')
  const narrowLeft = useMediaQuery('(max-width: 720px)')
  // 侧栏开合：用户偏好优先，未干预时随断点默认（宽开窄收）
  const [leftPref, setLeftPref] = useState<boolean | null>(null)
  const [rightPref, setRightPref] = useState<boolean | null>(null)
  const leftOpen = leftPref ?? !narrowLeft
  const rightOpen = rightPref ?? !narrowRight

  // A2/A3：实时指标与话题树（messages 本地派生）
  const metrics = useInterviewMetrics(props.messages as Msg[], props.streamingMeta)

  // A3 双向导航：scroll-spy 当前视口顶端附近的消息下标
  const [spyIdx, setSpyIdx] = useState<number | null>(null)
  function onChatScroll() {
    const el = chatRef.current
    if (!el) return
    const top = el.getBoundingClientRect().top + 90
    let cur: number | null = null
    el.querySelectorAll('[data-mid]').forEach((k) => {
      if (k.getBoundingClientRect().top <= top) cur = Number(k.getAttribute('data-mid'))
    })
    setSpyIdx(cur)
  }
  function scrollToMsg(idx: number) {
    const el = chatRef.current?.querySelector(`[data-mid="${idx}"]`)
    if (!el) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
    el.classList.add('flash')
    window.setTimeout(() => el.classList.remove('flash'), 1300)
  }

  useEffect(() => {
    if (!props.createdAt) return
    const base = new Date(props.createdAt).getTime()
    if (!Number.isFinite(base)) return
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - base) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [props.createdAt])

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
  }, [props.messages.length, props.streamingText])

  const isTyping = props.streamingText !== null
  const avatarState =
    props.thinking && !isTyping ? 'thinking' : speaker.speaking || isTyping ? 'speaking' : ''

  // B2：光环消费真实 TTS 电平（静音段静止、重音扩张）；总线未就绪/reduced-motion 回退 CSS 循环动画
  const ringRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ringRef.current
    if (!el) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (avatarState !== 'speaking' || !audioBusAvailable() || reduced) {
      el.classList.remove('live')
      el.style.transform = ''
      el.style.opacity = ''
      return
    }
    el.classList.add('live')
    let raf = 0
    let cur = 0
    const tick = () => {
      const lv = Math.min(1, readTtsLevels().rms * 4.5)
      cur += (lv - cur) * 0.3
      el.style.transform = `scale(${(1 + cur * 0.17).toFixed(3)})`
      el.style.opacity = (0.28 + cur * 0.62).toFixed(3)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [avatarState])
  const waveMode: 'mic' | 'voice' | 'idle' = listening
    ? 'mic'
    : speaker.speaking || isTyping
      ? 'voice'
      : 'idle'
  const stateLabel = props.reportStage
    ? '🧾 报告生成中…'
    : props.done
      ? '面试结束'
      : isTyping
        ? '面试官正在说'
        : props.thinking
          ? '面试官思考中'
          : speaker.speaking
            ? '面试官正在说'
            : listening
              ? '正在聆听你'
              : '等待你作答'

  const metricsPanel = (
    <MetricsPanel
      durationMin={durationSec > 0 ? (props.durationMin ?? null) : null}
      elapsedSec={elapsed}
      metrics={metrics}
    />
  )

  return (
    <div className="room-overlay">
      <div className="room-ambient" />
      <header className="room-top">
        <div className="room-title">
          {props.direction} · {props.roundLabel ?? (props.focused ? '专项训练' : '模拟面试')}
        </div>
        <div className="room-track-wrap">
          {durationSec > 0 ? (
            /* v2.4 时长驱动：时间进度条 + 剩余预算，替代固定题数轨道 */
            <>
              <div className="room-timebar" title={`目标 ${props.durationMin} 分钟`}>
                <div
                  className={`room-timebar-fill${remainingSec <= 300 ? ' low' : ''}`}
                  style={{ width: `${timeProgress}%` }}
                />
              </div>
              <span className="room-track-label">
                {props.done
                  ? `话题 ${props.mainCount} · 已结束`
                  : `话题 ${props.mainCount} · 剩余 ${fmtSigned(remainingSec)}`}
              </span>
            </>
          ) : (
            <>
              <div className="room-track" title={props.focused ? (props.roundLabel ?? '薄弱项专项 4 题') : '7 题进度'}>
                {(props.focused ? FOCUSED_TRACK : TRACK).map((label, i) => (
                  <div
                    key={label}
                    className={
                      'room-seg' + (i < props.mainCount ? ' done' : i === props.mainCount && !props.done ? ' cur' : '')
                    }
                    title={label}
                  />
                ))}
              </div>
              <span className="room-track-label">
                {props.done
                  ? '全部完成'
                  : `${props.mainCount}/${props.focused ? 4 : 7} · ${
                      props.focused ? (props.roundLabel ? '战役进行中' : '专项训练') : (props.nextType ?? '收尾')
                    }`}
              </span>
            </>
          )}
        </div>
        <div className="room-timer" title={durationSec > 0 ? `已进行 ${fmtElapsed(elapsed)} / 目标 ${props.durationMin} 分钟` : undefined}>
          {durationSec > 0
            ? remainingSec >= 0
              ? `⏱ ${fmtElapsed(elapsed)} · 剩 ${fmtSigned(remainingSec)}`
              : `⏱ ${fmtElapsed(elapsed)} · 已超时 ${fmtSigned(remainingSec)}`
            : `⏱ ${fmtElapsed(elapsed)}`}
        </div>
        <button className="btn small room-toggle" title="展开/收起话题树" onClick={() => setLeftPref(!leftOpen)}>
          🌲 话题
        </button>
        <button className="btn small room-toggle" title="展开/收起实时分析" onClick={() => setRightPref(!rightOpen)}>
          📊 分析
        </button>
        <button className="btn small" onClick={props.onExit}>
          ↓ 退出面试间
        </button>
      </header>

      <div className="room-body">
        <aside className={`room-left${leftOpen ? '' : ' closed'}`}>
          <div className="room-side-head">话题树</div>
          <TopicTree
            topics={metrics.topics}
            activeMsgIdx={isTyping ? -1 : spyIdx}
            onSelect={scrollToMsg}
          />
        </aside>

        <div className="room-center">
          <div className="room-stage">
            <div className={`room-avatar ${avatarState}`}>
              <img src={heroImg} alt="面试官" draggable={false} />
              <span className="avatar-ring" ref={ringRef} />
              <span className="thinking-dots">
                <i />
                <i />
                <i />
              </span>
            </div>
            <div className="room-state">{stateLabel}</div>
            <WaveCanvas mode={waveMode} />
          </div>

          <div className="room-chat" ref={chatRef} onScroll={onChatScroll}>
            {props.messages.map((m, i) => (
              <motion.div
                key={i}
                data-mid={i}
                variants={bubbleIn}
                initial={
                  !reducedMotion && m.role === 'interviewer' && i >= msgMountLen ? 'initial' : false
                }
                animate="animate"
              >
                <div
                  className={
                    'room-bubble ' +
                    m.role +
                    (m.role === 'interviewer' &&
                    speaker.speaking &&
                    speaker.playingTag === `room-${i}`
                      ? ' playing'
                      : '')
                  }
                  onClick={
                    m.role === 'interviewer'
                      ? () => {
                          if (speaker.speaking && speaker.playingTag === `room-${i}`) speaker.stop()
                          else speaker.speak(m.text, `room-${i}`)
                        }
                      : undefined
                  }
                  style={m.role === 'interviewer' ? { cursor: 'pointer' } : undefined}
                >
                  {m.role === 'interviewer' && m.meta?.question_type && (
                    <div className="room-bubble-tag">
                      {m.meta.is_main_question ? `主问题 · ${m.meta.question_type}` : `追问 · ${m.meta.question_type}`}
                    </div>
                  )}
                  {m.text}
                </div>
                {m.role === 'candidate' && (props.stats[i] || m.meta?.speech) && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <SpeechStrip
                      data={
                        props.stats[i]
                          ? {
                              rate: props.stats[i].rate,
                              fillers: props.stats[i].fillerTotal,
                              complete: props.stats[i].completeRate,
                              chars: props.stats[i].chars,
                            }
                          : m.meta?.speech ?? undefined
                      }
                    />
                  </div>
                )}
              </motion.div>
            ))}
            {props.streamingText !== null && (
              <motion.div
                className="room-bubble interviewer"
                style={{ cursor: 'pointer' }}
                variants={bubbleIn}
                initial={reducedMotion ? false : 'initial'}
                animate="animate"
              >
                {props.streamingMeta?.question_type && (
                  <div className="room-bubble-tag">
                    {props.streamingMeta.is_main_question
                      ? `主问题 · ${props.streamingMeta.question_type}`
                      : `追问 · ${props.streamingMeta.question_type}`}
                  </div>
                )}
                {props.streamingText}
                <span className="stream-cursor" />
              </motion.div>
            )}
          </div>

          <footer className="room-input">
            {props.done ? (
              <div className="btn-row" style={{ justifyContent: 'center' }}>
                <button className="btn primary" onClick={props.onExit}>
                  查看完整报告 ↓
                </button>
              </div>
            ) : (
              <>
                <AnswerInput
                  value={props.answer}
                  onChange={props.onAnswerChange}
                  rows={3}
                  placeholder="像面试口述一样作答（可语音、可修改，点提交发送）"
                  disabled={props.busy !== null}
                  muted={speaker.speaking}
                  onListeningChange={setListening}
                />
                <div className="room-voice-row">
                  <button className="btn primary" onClick={props.onSubmit} disabled={props.busy !== null}>
                    {props.busy === 'answer' ? '面试官思考中…' : '提交回答'}
                  </button>
                  <button className="btn danger" onClick={props.onEnd} disabled={props.busy !== null}>
                    {props.busy === 'end' ? '报告中…' : '结束面试'}
                  </button>
                  {speaker.supported && (
                    <label className="voice-toggle">
                      <input
                        type="checkbox"
                        checked={speaker.enabled}
                        onChange={(e) => {
                          speaker.setEnabled(e.target.checked)
                          if (!e.target.checked) speaker.stop()
                        }}
                      />
                      播报
                    </label>
                  )}
                  <label className="voice-rate" title="播报语速">
                    语速
                    <input
                      type="range"
                      min="0.7"
                      max="1.4"
                      step="0.05"
                      value={speaker.rate}
                      disabled={!speaker.enabled}
                      onChange={(e) => speaker.setRate(Number(e.target.value))}
                    />
                    {speaker.rate.toFixed(2)}x
                  </label>
                  {speaker.speaking && (
                    <button className="btn small" onClick={speaker.stop}>
                      ■ 停止播报
                    </button>
                  )}
                  {speaker.failed && (
                    <button className="tts-retry" onClick={speaker.retry}>
                      ⚠ 语音暂时不可用，点击重试
                    </button>
                  )}
                </div>
              </>
            )}
          </footer>
        </div>

        {!narrowRight && rightOpen && (
          <aside className="room-right">
            <div className="room-side-head">实时分析</div>
            {metricsPanel}
          </aside>
        )}
      </div>

      {/* ≤1200px：右栏收起为悬浮按钮抽屉 */}
      {narrowRight && !rightOpen && (
        <button className="room-fab" onClick={() => setRightPref(true)}>
          📊 分析
        </button>
      )}
      {narrowRight && rightOpen && (
        <div className="room-drawer-wrap">
          <div className="room-drawer-mask" onClick={() => setRightPref(false)} />
          <aside className="room-drawer">
            <div className="room-side-head drawer-head">
              实时分析
              <button className="btn small" onClick={() => setRightPref(false)}>
                收起 ✕
              </button>
            </div>
            {metricsPanel}
          </aside>
        </div>
      )}
    </div>
  )
}
