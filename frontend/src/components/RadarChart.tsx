/** 五维能力雷达（v2.3-2）：纯 SVG 绘制，支持多场叠加（每场一个多边形+图例）。
 *
 * 维度固定顺序：表达/深度/结构化/岗位匹配/应变；值域 0-10。
 * 主题适配：网格与文字用 CSS variables（var(--border)/var(--text-2)）。
 * C3：进入视口时数据多边形自转展开（scale+rotate 揭示感，系列间 stagger）；
 * prefers-reduced-motion 下直接静态呈现。
 */
import { motion, useReducedMotion } from '../motion'

export const RADAR_DIMS = ['表达', '深度', '结构化', '岗位匹配', '应变']

export interface RadarSeries {
  name: string
  /** 与 RADAR_DIMS 对齐的 5 个 0-10 值 */
  values: number[]
  color: string
}

const PALETTE = ['#6e8ef5', '#4ac26b', '#f0a83a', '#e070a8']

export function radarColors(n: number): string[] {
  return Array.from({ length: n }, (_, i) => PALETTE[i % PALETTE.length])
}

function pt(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
}

function clamp10(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : 0
}

export default function RadarChart(props: { series: RadarSeries[]; size?: number }) {
  const { series, size = 280 } = props
  const reduced = useReducedMotion()
  const cx = size / 2
  const cy = size / 2 + 4
  const R = size / 2 - 44 // 留标签边距
  const n = RADAR_DIMS.length
  const angles = Array.from({ length: n }, (_, i) => (-90 + (360 / n) * i) * (Math.PI / 180))

  const ring = (frac: number) =>
    angles
      .map((a) => pt(cx, cy, R * frac, a).map((v) => v.toFixed(1)).join(','))
      .join(' ')

  const polygon = (values: number[]) =>
    angles
      .map((a, i) => pt(cx, cy, (R * clamp10(values[i] ?? 0)) / 10, a).map((v) => v.toFixed(1)).join(','))
      .join(' ')

  return (
    <svg width="100%" viewBox={`0 0 ${size} ${size}`} style={{ maxWidth: size }} role="img" aria-label="五维能力雷达图">
      {/* 网格环 2/4/6/8/10 */}
      {[0.2, 0.4, 0.6, 0.8, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" style={{ stroke: 'var(--border)' }} strokeWidth={f === 1 ? 1.2 : 0.8} />
      ))}
      {/* 轴线与维度标签 */}
      {angles.map((a, i) => {
        const [x, y] = pt(cx, cy, R, a)
        const [lx, ly] = pt(cx, cy, R + 22, a)
        return (
          <g key={RADAR_DIMS[i]}>
            <line x1={cx} y1={cy} x2={x} y2={y} style={{ stroke: 'var(--border)' }} strokeWidth={0.8} />
            <text
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ fill: 'var(--text-2)', fontSize: 12.5, fontWeight: 600 }}
            >
              {RADAR_DIMS[i]}
            </text>
          </g>
        )
      })}
      {/* 数据多边形（后面的画在下层）；C3：进入时自转展开（reduced-motion 静态） */}
      {series.map((s, si) => (
        <motion.g
          key={s.name}
          initial={reduced ? false : { opacity: 0, scale: 0.35, rotate: -100 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 0.55, delay: 0.12 + si * 0.1, ease: [0.22, 0.9, 0.3, 1] }}
          style={{ transformOrigin: `${cx}px ${cy}px` }}
        >
          <polygon points={polygon(s.values)} fill={s.color} fillOpacity={0.16} stroke={s.color} strokeWidth={2} />
          {angles.map((a, i) => {
            const [x, y] = pt(cx, cy, (R * clamp10(s.values[i] ?? 0)) / 10, a)
            return <circle key={i} cx={x} cy={y} r={2.6} fill={s.color} />
          })}
        </motion.g>
      ))}
    </svg>
  )
}

/** 图例：色点 + 名称 + 分值串。 */
export function RadarLegend(props: { series: RadarSeries[] }) {
  return (
    <div className="radar-legend">
      {props.series.map((s) => (
        <span key={s.name} className="radar-legend-item">
          <i style={{ background: s.color }} />
          {s.name}
          <em>{s.values.map((v) => Math.round(v)).join(' · ')}</em>
        </span>
      ))}
    </div>
  )
}
