/** 工作包 A2：实时分析栏（驾驶舱右栏）。
 *  TimeBudgetRing 目标时长环形倒计时（专项 duration_min=null 整栏隐藏该环；
 *  剩余 ≤5 分钟琥珀色+脉冲，对齐引擎收尾节奏）；SpeechLiveCard 语速折线（最近 12 条）/
 *  填充词累计徽标 / 完整度均值；DepthIndicator 当前话题追问深度。数据全部本地派生。
 */
import { completeLevel } from '../../speech-analysis'
import type { InterviewMetrics, RatePoint } from './useInterviewMetrics'

function fmt(sec: number): string {
  const s = Math.abs(Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function TimeBudgetRing(props: { durationMin: number; elapsedSec: number }) {
  const total = props.durationMin * 60
  const remaining = total - props.elapsedSec
  const frac = Math.min(1, props.elapsedSec / total)
  const R = 52
  const C = 2 * Math.PI * R
  const low = remaining > 0 && remaining <= 300
  const over = remaining < 0
  return (
    <div className={`metric-ring${low ? ' low' : ''}${over ? ' over' : ''}`}>
      <svg viewBox="0 0 120 120" width="112" height="112">
        <circle cx="60" cy="60" r={R} className="ring-bg" />
        <circle
          cx="60"
          cy="60"
          r={R}
          className="ring-fg"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="ring-text">
        <b>{over ? `-${fmt(remaining)}` : fmt(remaining)}</b>
        <span>
          {over ? '已超时' : '剩余'} · 目标 {props.durationMin} 分钟
        </span>
      </div>
    </div>
  )
}

/** 语速折线（最近 12 条候选人作答 rate，SVG）；绿带 = 中文口述适中区 160-280 字/分。 */
function RateSparkline({ points }: { points: RatePoint[] }) {
  const W = 244
  const H = 66
  const P = 10
  if (!points.length) return <p className="metric-empty">暂无话速数据（作答 ≥10 秒入图）</p>
  const rates = points.map((p) => p.rate)
  const lo = Math.min(...rates, 120)
  const hi = Math.max(...rates, 300)
  const x = (i: number) => (points.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (points.length - 1))
  const y = (r: number) => H - P - ((r - lo) / (hi - lo || 1)) * (H - 2 * P)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rate).toFixed(1)}`).join(' ')
  const bandTop = y(Math.min(hi, 280))
  const bandBot = y(Math.max(lo, 160))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="rate-line" role="img" aria-label="语速折线">
      <rect x={P} y={bandTop} width={W - 2 * P} height={Math.max(2, bandBot - bandTop)} className="rate-band" />
      <path d={d} className="rate-path" fill="none" />
      {points.map((p, i) => (
        <circle key={p.msgIdx} cx={x(i)} cy={y(p.rate)} r={2.6} className="rate-dot" />
      ))}
      <text x={2} y={10} className="rate-scale">
        {hi}
      </text>
      <text x={2} y={H - 1} className="rate-scale">
        {lo}
      </text>
    </svg>
  )
}

function DepthIndicator(props: { metrics: InterviewMetrics }) {
  const { topics, depth } = props.metrics
  const last = topics[topics.length - 1]
  if (!last) return <p className="metric-empty">等待首个主问题</p>
  return (
    <div className="depth-box">
      <div className="depth-topic">
        Q{last.seq} · {last.qtype ?? '主问题'}
      </div>
      <div className="depth-value">{depth === 0 ? '主问题进行中' : `深挖第 ${depth} 层`}</div>
      {depth > 0 && (
        <div className="depth-bars" aria-hidden>
          {Array.from({ length: depth }, (_, i) => (
            <i key={i} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function MetricsPanel(props: {
  durationMin: number | null
  elapsedSec: number
  metrics: InterviewMetrics
}) {
  const m = props.metrics
  const c = m.completeAvg != null ? completeLevel(m.completeAvg) : null
  return (
    <div className="metrics-panel">
      {props.durationMin != null && (
        <section className="metric-card">
          <h4>时间预算</h4>
          <TimeBudgetRing durationMin={props.durationMin} elapsedSec={props.elapsedSec} />
        </section>
      )}
      <section className="metric-card">
        <h4>表达实时</h4>
        <RateSparkline points={m.rates} />
        <div className="metric-chips">
          <span className="mc-chip">
            填充词累计 <b>{m.fillerTotal}</b>
          </span>
          <span className="mc-chip">
            完整度均值 <b>{m.completeAvg == null ? '—' : `${Math.round(m.completeAvg * 100)}%`}</b>
            {c && <em className={c.cls}>{c.label}</em>}
          </span>
        </div>
      </section>
      <section className="metric-card">
        <h4>追问深度</h4>
        <DepthIndicator metrics={m} />
      </section>
    </div>
  )
}
