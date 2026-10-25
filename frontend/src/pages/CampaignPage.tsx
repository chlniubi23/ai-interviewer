/** 战役综合评估页（/campaign/:id，D1 路由化拆分自原 InterviewPage.tsx 的 CampaignCard）。
 *  详情经 TanStack Query 缓存；「查看报告」跳 /session/:id。
 */
import { Navigate, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import RadarChart, { RadarLegend, RADAR_DIMS, radarColors, type RadarSeries } from '../components/RadarChart'
import { EmptyState, Skeleton } from '../components/ui'
import { motion, useReducedMotion } from '../motion'
import { useInterviewSession } from '../session'
import { CAMPAIGN_ROUND_NAMES, type CampaignInfo } from '../interview-types'

export default function CampaignPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const ctx = useInterviewSession()

  const q = useQuery({
    queryKey: ['campaign', id ?? ''],
    queryFn: () => api<{ campaign: CampaignInfo }>(`/api/interview/campaigns/${id}`).then((d) => d.campaign),
    enabled: id != null && /^\d+$/.test(id),
    retry: 1,
  })

  if (id == null || !/^\d+$/.test(id)) return <Navigate to="/" replace />
  if (q.isPending) return <Skeleton lines={5} />
  if (q.isError) {
    return (
      <section className="card">
        <EmptyState icon="⚠️" title="读取战役失败" hint={(q.error as Error).message}>
          <button className="btn" onClick={() => navigate('/')}>
            返回首页
          </button>
        </EmptyState>
      </section>
    )
  }

  return (
    <CampaignCard
      campaign={q.data}
      onBack={() => navigate('/')}
      onOpenSession={ctx.openSessionById}
    />
  )
}

/** v2.3-3 战役综合评估视图：ready 判断 + 三轮雷达叠加 + 轮次明细。 */
function CampaignCard(props: {
  campaign: CampaignInfo
  onBack: () => void
  onOpenSession: (id: number) => void
}) {
  const { campaign } = props
  const reduced = useReducedMotion()
  const v = campaign.verdict
  const series: RadarSeries[] = campaign.rounds
    .filter((r) => r.dimensions && RADAR_DIMS.every((d) => typeof r.dimensions?.[d] === 'number'))
    .map((r, i) => ({
      name: `第${r.round}轮·${r.name}（${r.avg ?? '—'}分）`,
      values: RADAR_DIMS.map((d) => r.dimensions?.[d] ?? 0),
      color: radarColors(3)[i % 3],
    }))
  return (
    // C2：与首页战役行共享元素过渡（layoutId 成对，reduced-motion 下静态）
    <motion.div className="stack" layoutId={reduced ? undefined : `campaign-${campaign.id}`}>
      <section className="card">
        <div className="card-head">
          <h2>{campaign.direction} · 面试战役综合评估</h2>
          <button className="btn" onClick={props.onBack}>
            返回
          </button>
        </div>
        {!v ? (
          <EmptyState icon="🧾" title="评估生成中或缺失" hint="三轮刚完成但评估未出时，回到第 3 轮报告页再点一次「生成综合评估」。" />
        ) : (
          <>
            <div className={`verdict-badge ${v.ready ? 'go' : 'hold'}`}>
              {v.ready ? '✅ 可上战场' : `⚠ ${v.level}`}
            </div>
            {v.comment && <p className="reason">{v.comment}</p>}
            {v.round_progression.length > 0 && (
              <>
                <h4>三轮走势</h4>
                <ul className="req-list">
                  {v.round_progression.map((p, i) => (
                    <li key={i}>
                      <b>第{i + 1}轮·{CAMPAIGN_ROUND_NAMES[i]}：</b>
                      {p}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {v.strengths.length > 0 && (
              <>
                <h4>跨轮稳定优势</h4>
                <ul className="req-list">
                  {v.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            )}
            {v.risks.length > 0 && (
              <>
                <h4>挂掉风险</h4>
                <ul className="gap-list">
                  {v.risks.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            )}
            {v.action_plan.length > 0 && (
              <>
                <h4>接下来 7 天行动计划</h4>
                <ul className="req-list">
                  {v.action_plan.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      {series.length > 0 && (
        <section className="card">
          <h2>三轮能力雷达</h2>
          <div className="radar-box">
            <RadarChart series={series} size={320} />
            <RadarLegend series={series} />
          </div>
        </section>
      )}

      <section className="card">
        <h2>三轮明细</h2>
        {campaign.rounds.map((r) => (
          <div key={r.session_id} className="history-row">
            <span className="chip none">
              第{r.round}轮·{r.name}
            </span>
            {r.avg != null && <span className={r.avg >= 8 ? 'chip go' : r.avg >= 5 ? 'chip hold' : 'chip drop'}>{r.avg} 分</span>}
            <span className="muted">{r.status === 'done' ? '已完成' : '进行中'}</span>
            <button className="btn small" onClick={() => props.onOpenSession(r.session_id)}>
              查看报告
            </button>
          </div>
        ))}
      </section>
    </motion.div>
  )
}
