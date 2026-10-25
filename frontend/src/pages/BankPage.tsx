/** 题库页（D2：列表/详情迁移 TanStack Query；删除/作答/复盘走 useMutation 并做失效联动）。 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import AnswerInput from '../components/AnswerInput'
import AutoTextarea from '../components/AutoTextarea'
import RadarChart, { RadarLegend, RADAR_DIMS, radarColors, type RadarSeries } from '../components/RadarChart'
import { CountUp, EmptyState, Skeleton } from '../components/ui'
import { DIRECTIONS } from '../types'

interface MsgBanner {
  kind: 'ok' | 'error' | 'info'
  text: string
}

interface Feedback {
  score?: number
  comment?: string
  key_points?: string[]
  suggestions?: string[]
}

interface QAItem {
  id: number
  session_id: string | null
  session_type: 'mock' | 'real'
  direction: string | null
  question_type: string | null
  question: string
  hint: string | null
  my_answer: string | null
  score: number | null
  feedback: Feedback | null
  job: { id: number; company: string; title: string } | null
  created_at: string | null
}

interface ReportItem {
  question_type: string
  question: string
  score: number
  comment: string
  key_points: string[]
  suggestions: string[]
}

interface SessionInfo {
  id: number
  direction: string
  jd_text: string | null
  status: 'running' | 'done'
  focused?: boolean
  duration_min?: number | null
  created_at: string | null
  finished_at: string | null
  summary: { avg: number | null; count: number; weaknesses: string[]; dimensions: Record<string, number> | null }
}

interface SessionDetail extends SessionInfo {
  messages: unknown[]
  report: { overall_comment: string; strengths: string[]; weaknesses: string[]; items: ReportItem[] } | null
}

interface Stats {
  total_sessions: number
  done_sessions: number
  total_items: number
  avg_score: number | null
  type_stats: { type: string; avg: number; count: number }[]
  trend: { id: number; direction: string; date: string | null; avg: number | null }[]
  recent_weaknesses: string[]
}

type Mode = 'practice' | 'real'

function scoreChip(score: number | null): string {
  if (score == null) return 'chip none'
  if (score >= 8) return 'chip go'
  if (score >= 5) return 'chip hold'
  return 'chip drop'
}

/** 单条题库记录删除（二次确认），失效所有 qa 查询。 */
function DelBtn(props: { id: number; onDone?: () => void }) {
  const qc = useQueryClient()
  const del = useMutation({
    mutationFn: (id: number) => api(`/api/interview/qa/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['qa'] })
      props.onDone?.()
    },
    onError: (e) => alert(`删除失败：${(e as Error).message}`),
  })
  return (
    <button
      className="btn small danger"
      disabled={del.isPending}
      onClick={() => {
        if (!confirm('删除这条记录？删除后不可恢复。')) return
        del.mutate(props.id)
      }}
    >
      {del.isPending ? '删除中…' : '删除'}
    </button>
  )
}

function fmtTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function BankPage() {
  const [mode, setMode] = useState<Mode>('practice')

  return (
    <div className="stack">
      <section className="card">
        <div className="seg">
          {(
            [
              ['practice', '练习记录'],
              ['real', '真实面试复盘'],
            ] as [Mode, string][]
          ).map(([k, label]) => (
            <button key={k} className={`seg-btn${mode === k ? ' active' : ''}`} onClick={() => setMode(k)}>
              {label}
            </button>
          ))}
        </div>
      </section>
      {mode === 'practice' && <PracticePanel />}
      {mode === 'real' && <RealPanel />}
    </div>
  )
}

/** 练习记录：统计概览 + 按会话组织的模拟面试 + 早期零散题目。 */
function PracticePanel() {
  const sessionsQ = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<{ sessions: SessionInfo[] }>('/api/interview/sessions'),
  })
  const statsQ = useQuery({
    queryKey: ['stats'],
    queryFn: () => api<Stats>('/api/interview/stats'),
  })

  const sessions = sessionsQ.data?.sessions ?? []
  const stats = statsQ.data ?? null
  const loaded = !sessionsQ.isPending && !statsQ.isPending

  const doneSessions = sessions.filter((s) => s.status === 'done')
  const runningSessions = sessions.filter((s) => s.status === 'running')

  return (
    <>
      <section className="card">
        <h2>练习统计</h2>
        {!stats ? (
          <Skeleton lines={4} />
        ) : stats.done_sessions === 0 ? (
          <EmptyState icon="📊" title="还没有完成的模拟面试" hint="去「面试」页完成一场，这里会给出均分、薄弱题型和进步趋势。" />
        ) : (
          <>
            <div className="stat-cards">
              <div className="stat-card">
                <div className="stat-num">
                  <CountUp value={stats.done_sessions} />
                </div>
                <div className="muted">完成场次</div>
              </div>
              <div className="stat-card">
                <div className="stat-num">
                  <CountUp value={stats.avg_score} decimals={1} />
                </div>
                <div className="muted">总平均分</div>
              </div>
              <div className="stat-card">
                <div className="stat-num">
                  <CountUp value={stats.total_items} />
                </div>
                <div className="muted">累计答题</div>
              </div>
              <div className="stat-card">
                <div className="stat-num">{stats.type_stats.length ? <CountUp value={stats.type_stats[0].avg} decimals={1} /> : '—'}</div>
                <div className="muted">最薄弱题型{stats.type_stats.length ? `：${stats.type_stats[0].type}` : ''}</div>
              </div>
            </div>

            {stats.type_stats.length > 0 && (
              <div className="stat-bars">
                {stats.type_stats.map((t) => (
                  <div key={t.type} className="stat-bar-row">
                    <span className="stat-bar-label">{t.type}（{t.count}题）</span>
                    <div className="stat-bar-track">
                      <div className={`stat-bar-fill ${t.avg < 5 ? 'low' : t.avg < 8 ? 'mid' : 'good'}`} style={{ width: `${t.avg * 10}%` }} />
                    </div>
                    <span className="stat-bar-val">{t.avg}</span>
                  </div>
                ))}
              </div>
            )}

            {stats.trend.length > 1 && (
              <>
                <h4>分数趋势（按场次）</h4>
                <div className="stat-trend">
                  {stats.trend.map((t) => (
                    <div key={t.id} className="trend-col" title={`${t.direction} ${fmtTime(t.date)}`}>
                      <div className={`trend-bar ${(t.avg ?? 0) < 5 ? 'low' : (t.avg ?? 0) < 8 ? 'mid' : 'good'}`} style={{ height: `${(t.avg ?? 0) * 8}px` }} />
                      <span className="muted">{t.avg}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {stats.recent_weaknesses.length > 0 && (
              <>
                <h4>最近薄弱项</h4>
                <ul className="gap-list">
                  {stats.recent_weaknesses.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      <RadarCompareCard sessions={doneSessions} />

      <section className="card">
        <h2>模拟面试记录（{doneSessions.length}）</h2>
        {!loaded ? (
          <Skeleton lines={3} />
        ) : doneSessions.length === 0 ? (
          <EmptyState icon="🗂️" title="还没有完成的模拟面试" hint="完成的每一场面试都会沉淀在这里。" />
        ) : (
          doneSessions.map((s) => <SessionRow key={s.id} info={s} />)
        )}
        {runningSessions.length > 0 && (
          <p className="msg info">另有 {runningSessions.length} 场进行中的面试，可在「面试」页继续。</p>
        )}
      </section>

      <LegacyQaSection sessionIds={new Set(sessions.map((s) => String(s.id)))} sessionsLoaded={!sessionsQ.isPending} />
    </>
  )
}

/** v2.3-2 五维能力雷达对比：勾选多场已完成的面试叠加在同一雷达上，看短板变化。 */
function RadarCompareCard(props: { sessions: SessionInfo[] }) {
  const { sessions } = props
  const withDims = sessions.filter(
    (s) => s.summary.dimensions && RADAR_DIMS.every((d) => typeof s.summary.dimensions?.[d] === 'number'),
  )
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [defaulted, setDefaulted] = useState(false)

  // 默认选中最近一场（有五维数据的）
  if (!defaulted && withDims.length > 0) {
    setPicked(new Set([withDims[0].id]))
    setDefaulted(true)
  }

  if (!withDims.length) return null

  function toggle(id: number, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (on) {
        if (next.size >= 4) return prev // 最多 4 场叠加，太多看不清
        next.add(id)
      } else next.delete(id)
      return next
    })
  }

  const series: RadarSeries[] = withDims
    .filter((s) => picked.has(s.id))
    .map((s, i) => ({
      name: `${s.direction}${s.focused ? '·专项' : ''} ${fmtTime(s.finished_at ?? s.created_at).slice(0, 5)}（${s.summary.avg ?? '—'}分）`,
      values: RADAR_DIMS.map((d) => s.summary.dimensions?.[d] ?? 0),
      color: radarColors(4)[i % 4],
    }))

  return (
    <section className="card">
      <h2>五维能力雷达对比</h2>
      <p className="muted">勾选 1-4 场已完成的面试叠加对比（表达 / 深度 / 结构化 / 岗位匹配 / 应变），看短板有没有在变强。</p>
      <div className="radar-pick">
        {withDims.map((s) => (
          <label key={s.id} className="voice-toggle">
            <input
              type="checkbox"
              checked={picked.has(s.id)}
              onChange={(e) => toggle(s.id, e.target.checked)}
              disabled={!picked.has(s.id) && picked.size >= 4}
            />
            {s.direction}
            {s.focused ? '·专项' : ''} {fmtTime(s.finished_at ?? s.created_at).slice(0, 5)}
            {s.summary.avg != null ? `（${s.summary.avg}分）` : ''}
          </label>
        ))}
      </div>
      {series.length > 0 ? (
        <div className="radar-box">
          <RadarChart series={series} size={320} />
          <RadarLegend series={series} />
        </div>
      ) : (
        <p className="muted">勾选上方场次查看雷达。</p>
      )}
    </section>
  )
}

function SessionRow(props: { info: SessionInfo }) {
  const { info } = props
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [checked, setChecked] = useState<Set<number>>(new Set())

  // 报告缺失仍可看逐题：详情失败不阻塞 qa 列表
  const detailQ = useQuery({
    queryKey: ['session', info.id],
    queryFn: () => api<{ session: SessionDetail }>(`/api/interview/sessions/${info.id}`).then((d) => d.session),
    enabled: open,
    retry: 1,
  })
  const qaQ = useQuery({
    queryKey: ['qa', 'session', info.id],
    queryFn: () => api<{ items: QAItem[] }>(`/api/interview/qa?session_id=${info.id}`).then((d) => d.items),
    enabled: open,
  })
  const detail = detailQ.data ?? null
  const qaRows = qaQ.data ?? []

  const delChecked = useMutation({
    mutationFn: async (ids: number[]) => {
      for (const id of ids) {
        await api(`/api/interview/qa/${id}`, { method: 'DELETE' })
      }
    },
    onSuccess: () => {
      setChecked(new Set())
      void qc.invalidateQueries({ queryKey: ['qa'] })
    },
    onError: (e) => {
      alert(`部分删除失败：${(e as Error).message}`)
      void qc.invalidateQueries({ queryKey: ['qa'] })
    },
  })

  function toggleOne(id: number, on: boolean) {
    setChecked((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const allChecked = qaRows.length > 0 && checked.size === qaRows.length

  function deleteChecked() {
    if (!checked.size) return
    if (
      !confirm(
        `删除所选的 ${checked.size} 条面试题记录？删除后不可恢复。\n（会话报告与练习统计保留原快照，不受影响）`,
      )
    )
      return
    delChecked.mutate(Array.from(checked))
  }

  return (
    <div className="session-item">
      <div className="history-row" onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
        <span className={scoreChip(info.summary.avg)}>{info.summary.avg != null ? `${info.summary.avg} 分` : '—'}</span>
        <span className="strong">{info.direction}</span>
        {info.focused && <span className="chip none">专项</span>}
        {info.duration_min != null && <span className="chip none">{info.duration_min}分钟档</span>}
        <span className="muted">{info.summary.count} 题</span>
        <span className="muted">{fmtTime(info.finished_at ?? info.created_at)}</span>
        <span className="muted">{info.jd_text ? '含JD' : '知识库出题'}</span>
        <span className="muted">{open ? '▲ 收起' : '▼ 展开报告'}</span>
      </div>
      {open && (
        <div className="session-detail">
          {detail?.report ? (
            <>
              {detail.report.overall_comment && <p className="reason">{detail.report.overall_comment}</p>}
              {detail.report.weaknesses.length > 0 && (
                <ul className="gap-list">
                  {detail.report.weaknesses.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="muted">报告数据缺失（逐题记录仍可查看）。</p>
          )}

          <div className="batch-bar">
            <label className="voice-toggle">
              <input
                type="checkbox"
                checked={allChecked}
                disabled={delChecked.isPending || !qaRows.length}
                onChange={(e) =>
                  setChecked(e.target.checked ? new Set(qaRows.map((q) => q.id)) : new Set())
                }
              />
              全选（{qaRows.length} 题）
            </label>
            <button
              className="btn small danger"
              onClick={deleteChecked}
              disabled={delChecked.isPending || !checked.size}
            >
              {delChecked.isPending ? '删除中…' : `删除所选（${checked.size}）`}
            </button>
          </div>

          {qaRows.map((q) => (
            <div key={q.id} className="report-detail-item">
              <div className="qa-head" style={{ cursor: 'default' }}>
                <input
                  type="checkbox"
                  checked={checked.has(q.id)}
                  disabled={delChecked.isPending}
                  onChange={(e) => toggleOne(q.id, e.target.checked)}
                />
                <span className="chip none">{q.question_type || '未分类'}</span>
                {q.score != null && <span className={scoreChip(q.score)}>{q.score} 分</span>}
                <span className="qa-question-inline">{q.question.split('\n')[0].slice(0, 46)}</span>
              </div>
              <details>
                <summary className="muted">详情</summary>
                <div className="qa-question">{q.question}</div>
                {q.feedback?.comment && <p className="reason">{q.feedback.comment}</p>}
                {q.feedback?.key_points && q.feedback.key_points.length > 0 && (
                  <ul className="req-list">
                    {q.feedback.key_points.map((k, j) => (
                      <li key={j}>{k}</li>
                    ))}
                  </ul>
                )}
                {q.feedback?.suggestions && q.feedback.suggestions.length > 0 && (
                  <ul className="gap-list">
                    {q.feedback.suggestions.map((s, j) => (
                      <li key={j}>{s}</li>
                    ))}
                  </ul>
                )}
                {q.my_answer && (
                  <details>
                    <summary className="muted">我的回答</summary>
                    <p className="notes">{q.my_answer}</p>
                  </details>
                )}
              </details>
            </div>
          ))}
          {!qaRows.length && <p className="muted">（该会话暂无可删除的逐题记录）</p>}
        </div>
      )}
    </div>
  )
}

/** 早期（v1 固定题组）遗留题目：不隶属任何会话，仍可作答评分。 */
function LegacyQaSection(props: { sessionIds: Set<string>; sessionsLoaded: boolean }) {
  const qaQ = useQuery({
    queryKey: ['qa', 'mock-legacy'],
    queryFn: () => api<{ items: QAItem[] }>('/api/interview/qa?session_type=mock').then((d) => d.items),
    select: (items) => items.filter((i) => !i.session_id || !props.sessionIds.has(i.session_id)),
  })

  if (!props.sessionsLoaded || !qaQ.data || qaQ.data.length === 0) return null
  const items = qaQ.data
  const reload = () => qaQ.refetch()

  return (
    <section className="card">
      <details>
        <summary className="muted" style={{ cursor: 'pointer' }}>早期题目（{items.length}，可继续作答）</summary>
        {items.map((item) =>
          item.my_answer == null ? (
            <QuestionCard
              key={item.id}
              item={item}
              onUpdated={() => reload()}
              onDelete={() => reload()}
            />
          ) : (
            <div key={item.id} className="qa-card bank-item">
              <div className="qa-head">
                <span className="chip none">{item.question_type ?? '未分类'}</span>
                {item.score != null && <span className={scoreChip(item.score)}>{item.score} 分</span>}
                <span className="muted">{item.created_at?.slice(5, 16).replace('T', ' ')}</span>
                <DelBtn id={item.id} onDone={() => reload()} />
              </div>
              <div className="qa-question">{item.question}</div>
              <details>
                <summary className="muted">回答与点评</summary>
                {item.feedback?.comment && <p className="reason">{item.feedback.comment}</p>}
                <p className="notes">我的回答：{item.my_answer}</p>
              </details>
            </div>
          ),
        )}
      </details>
    </section>
  )
}

function QuestionCard(props: { item: QAItem; onUpdated: () => void; onDelete?: () => void }) {
  const { item } = props
  const qc = useQueryClient()
  const [answer, setAnswer] = useState(item.my_answer ?? '')
  const [error, setError] = useState<string | null>(null)

  const submit = useMutation({
    mutationFn: (text: string) =>
      api(`/api/interview/qa/${item.id}/answer`, {
        method: 'POST',
        body: JSON.stringify({ answer: text }),
      }),
    onSuccess: () => {
      setError(null)
      void qc.invalidateQueries({ queryKey: ['qa'] })
      props.onUpdated()
    },
    onError: (e) => setError((e as Error).message),
  })

  function onSubmit() {
    if (answer.trim().length < 5) {
      setError('回答太短')
      return
    }
    submit.mutate(answer)
  }

  return (
    <div className="qa-card">
      <div className="qa-head">
        <span className="chip none">{item.question_type}</span>
        <span className="muted">#{item.id}</span>
        {props.onDelete && <DelBtn id={item.id} onDone={props.onDelete} />}
      </div>
      <div className="qa-question">{item.question}</div>
      {item.hint && <div className="qa-hint">考察点：{item.hint}</div>}
      <AnswerInput
        value={answer}
        onChange={setAnswer}
        rows={4}
        placeholder="语音作答或打字作答，像面试口述一样"
        disabled={submit.isPending}
      />
      {error && <p className="msg error">{error}</p>}
      <button className="btn primary" onClick={onSubmit} disabled={submit.isPending}>
        {submit.isPending ? '评分中（约20-60秒）…' : '确认提交评分'}
      </button>
    </div>
  )
}

/** 真实面试复盘：表单 + 历史复盘列表。 */
function RealPanel() {
  const qc = useQueryClient()
  const [direction, setDirection] = useState('AI产品')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [msg, setMsg] = useState<MsgBanner | null>(null)
  const [result, setResult] = useState<QAItem | null>(null)

  const historyQ = useQuery({
    queryKey: ['qa', 'real'],
    queryFn: () => api<{ items: QAItem[] }>('/api/interview/qa?session_type=real').then((d) => d.items),
  })
  const history = historyQ.data ?? []

  const submit = useMutation({
    mutationFn: (body: { question: string; my_answer: string; direction: string }) =>
      api<{ item: QAItem }>('/api/interview/real', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (d) => {
      setResult(d.item)
      setQuestion('')
      setAnswer('')
      setMsg({ kind: 'ok', text: '复盘完成，已沉淀进题库' })
      void qc.invalidateQueries({ queryKey: ['qa'] })
    },
    onError: (e) => setMsg({ kind: 'error', text: `复盘失败：${(e as Error).message}` }),
  })

  function onSubmit() {
    setMsg({ kind: 'info', text: 'AI 复盘中（约20-60秒）…' })
    setResult(null)
    submit.mutate({ question, my_answer: answer, direction })
  }

  return (
    <>
      <section className="card">
        <h2>真实面试复盘</h2>
        <p className="muted">记录真实面试被问的问题 + 你当时的回答，AI 分析哪里可以答得更好，自动沉淀进题库。</p>
        <div className="upload-row">
          <select value={direction} onChange={(e) => setDirection(e.target.value)}>
            {DIRECTIONS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <label className="field">
          <span>被问到的问题</span>
          <AutoTextarea
            value={question}
            onChange={setQuestion}
            minRows={2}
            maxRows={6}
            maxWidthChars={40}
            disabled={submit.isPending}
          />
        </label>
        <label className="field">
          <span>当时的回答（没答上就写「当时没答上来」；也可语音输入再修改）</span>
          <AnswerInput value={answer} onChange={setAnswer} rows={4} disabled={submit.isPending} />
        </label>
        <button
          className="btn primary"
          onClick={onSubmit}
          disabled={submit.isPending || question.trim().length < 5 || answer.trim().length < 5}
        >
          {submit.isPending ? '分析中…' : '提交 AI 复盘'}
        </button>
        {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}

        {result && (
          <div className="qa-card answered">
            <div className="qa-head">
              <span className={scoreChip(result.score)}>{result.score} 分</span>
              <span className="muted">复盘结果（已入库）</span>
            </div>
            <div className="qa-question">{result.question}</div>
            <div className="qa-result">
              {result.feedback?.comment && <p className="reason">{result.feedback.comment}</p>}
              {result.feedback?.key_points && result.feedback.key_points.length > 0 && (
                <>
                  <h4>参考要点</h4>
                  <ul className="req-list">
                    {result.feedback.key_points.map((k, i) => (
                      <li key={i}>{k}</li>
                    ))}
                  </ul>
                </>
              )}
              {result.feedback?.suggestions && result.feedback.suggestions.length > 0 && (
                <>
                  <h4>怎么答更好</h4>
                  <ul className="gap-list">
                    {result.feedback.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>复盘历史（{history.length}）</h2>
        {historyQ.isPending ? (
          <Skeleton lines={3} />
        ) : history.length === 0 ? (
          <EmptyState icon="📝" title="还没有复盘记录" hint="面完真实面试回来记一笔，积累你自己的真题库。" />
        ) : (
          history.map((item) => (
            <div key={item.id} className="qa-card bank-item">
              <div className="qa-head">
                <span className="chip none">真实</span>
                {item.score != null && <span className={scoreChip(item.score)}>{item.score} 分</span>}
                {item.direction && <span className="muted">{item.direction}</span>}
                <span className="muted">{item.created_at?.slice(5, 16).replace('T', ' ')}</span>
                <DelBtn id={item.id} />
              </div>
              <div className="qa-question">{item.question}</div>
              <details>
                <summary className="muted">回答与点评</summary>
                {item.feedback?.comment && <p className="reason">{item.feedback.comment}</p>}
                {item.feedback?.key_points && item.feedback.key_points.length > 0 && (
                  <ul className="req-list">
                    {item.feedback.key_points.map((k, i) => (
                      <li key={i}>{k}</li>
                    ))}
                  </ul>
                )}
                {item.feedback?.suggestions && item.feedback.suggestions.length > 0 && (
                  <ul className="gap-list">
                    {item.feedback.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
                <p className="notes">我的回答：{item.my_answer}</p>
              </details>
            </div>
          ))
        )}
      </section>
    </>
  )
}
