/** 表达反馈条（v2.3-1）：候选人气泡下方展示 语速/填充词/句完整度。
 * 数据来源：本地实时统计（SpeechStat）或会话消息 meta.speech（恢复会话时）。 */
import { completeLevel, fillerLevel, rateLevel } from '../speech-analysis'

export interface StripData {
  rate?: number
  fillers?: number
  complete?: number
  chars?: number
}

function absFillerLevel(count: number): { label: string; cls: string } {
  if (count < 3) return { label: '干净', cls: 'good' }
  if (count < 6) return { label: '偏多', cls: 'mid' }
  return { label: '口头禅', cls: 'low' }
}

export default function SpeechStrip({ data }: { data: StripData | null | undefined }) {
  if (!data || (!data.rate && !data.fillers && !data.complete)) return null
  const r = data.rate ? rateLevel(data.rate) : null
  const f =
    data.fillers != null
      ? data.chars
        ? fillerLevel(data.fillers, data.chars)
        : absFillerLevel(data.fillers)
      : null
  const c = data.complete != null ? completeLevel(data.complete) : null
  return (
    <div className="speech-strip">
      {r && (
        <span className={`strip-item ${r.cls}`}>
          语速 {data.rate}字/分 · {r.label}
        </span>
      )}
      {f && (
        <span className={`strip-item ${f.cls}`}>
          填充词 {data.fillers}次 · {f.label}
        </span>
      )}
      {c && <span className={`strip-item ${c.cls}`}>句完整 {Math.round((data.complete ?? 0) * 100)}%</span>}
    </div>
  )
}
