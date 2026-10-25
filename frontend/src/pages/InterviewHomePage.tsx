/** 面试首页（D1/D2 拆分自原 InterviewPage.tsx 的 home 分支）：
 *  驾驶舱 + 新建表单 + 战役列表 + 历史列表。
 *  列表/统计经 TanStack Query 缓存；打开会话/战役一律走路由，活动会话由 SessionProvider 托管。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import AutoTextarea from '../components/AutoTextarea'
import { CountUp, EmptyState, Skeleton } from '../components/ui'
import { motion, useReducedMotion } from '../motion'
import { useInterviewSession } from '../session'
import { DIRECTIONS } from '../types'
import {
  CAMPAIGN_ROUND_NAMES,
  fmtTime,
  type CampaignInfo,
  type MsgBanner,
  type SessionInfo,
  type StatsSummary,
} from '../interview-types'
import avatarImg from '../assets/interviewer-256.png'

export default function InterviewHomePage() {
  const navigate = useNavigate()
  const ctx = useInterviewSession()
  const qc = useQueryClient()
  const reduced = useReducedMotion()

  const sessionsQ = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<{ sessions: SessionInfo[] }>('/api/interview/sessions'),
  })
  const statsQ = useQuery({
    queryKey: ['stats'],
    queryFn: () => api<StatsSummary>('/api/interview/stats'),
  })
  const campaignsQ = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api<{ campaigns: CampaignInfo[] }>('/api/interview/campaigns'),
  })
  // v2.6-2 冷启动：无简历时建会话必 404——前置查询提前拦截并引导去简历页
  // （GET /api/profile 空库返回 200 + profile:null，网络错误不误拦）
  const profileQ = useQuery({
    queryKey: ['profile'],
    queryFn: () => api<{ profile: { id: number } | null }>('/api/profile'),
    retry: false,
  })
  const noProfile = profileQ.isSuccess && !profileQ.data?.profile

  const history = sessionsQ.data?.sessions ?? []
  const stats = statsQ.data ?? null
  const campaigns = campaignsQ.data?.campaigns ?? []
  const running = history.find((s) => s.status === 'running') ?? null

  const delSession = useMutation({
    mutationFn: (id: number) => api(`/api/interview/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] })
      void qc.invalidateQueries({ queryKey: ['stats'] })
      void qc.invalidateQueries({ queryKey: ['qa'] })
    },
    onError: (e) => alert(`删除失败：${(e as Error).message}`),
  })

  // 进行中战役的「继续」：最后一轮会话在跑 → 继续那场；否则流式开下一轮
  function continueCampaign(c: CampaignInfo) {
    const lastRound = c.rounds[c.rounds.length - 1]
    if (lastRound && lastRound.status === 'running') ctx.openSessionById(lastRound.session_id)
    else if (c.next_round)
      ctx.startStreaming({
        direction: c.direction,
        jd_text: c.jd_text,
        jd_source: null,
        campaign_id: c.id,
        campaign_round: c.next_round,
      })
  }

  return (
    <div className="stack">
      <CockpitCard
        stats={stats}
        history={history}
        campaigns={campaigns}
        onContinueSession={() => running && ctx.openSessionById(running.id)}
        onContinueCampaign={continueCampaign}
        onOpenCampaign={(id) => navigate(`/campaign/${id}`)}
        onStartFocused={(info) => ctx.startStreaming(info)}
      />

      <NewSessionCard noProfile={noProfile} />

      {campaigns.length > 0 && (
        <section className="card">
          <h2>面试战役（{campaigns.filter((c) => c.status === 'done').length}/{campaigns.length} 已收官）</h2>
          {campaigns.map((c) => (
            <motion.div
              key={c.id}
              className="history-row"
              layoutId={reduced ? undefined : `campaign-${c.id}`}
            >
              <span className={`chip ${c.status === 'done' ? (c.verdict?.ready ? 'go' : 'hold') : 'none'}`}>
                {c.status === 'done' ? (c.verdict?.ready ? '可上战场' : (c.verdict?.level || '已收官')) : `进行中 ${c.current_round}/3`}
              </span>
              <span className="strong">{c.direction}</span>
              <span className="muted">{fmtTime(c.created_at)}</span>
              {c.status === 'done' && c.rounds.length === 3 && (
                <span className="muted">三轮均分 {c.rounds.map((r) => r.avg ?? '—').join(' / ')}</span>
              )}
              <button className="btn small" onClick={() => (c.status === 'done' ? navigate(`/campaign/${c.id}`) : continueCampaign(c))}>
                {c.status === 'done' ? '查看综合评估' : '继续'}
              </button>
            </motion.div>
          ))}
        </section>
      )}

      <section className="card">
        <h2>历史面试（{history.length}）</h2>
        {sessionsQ.isPending ? (
          <Skeleton lines={3} />
        ) : !history.length ? (
          <EmptyState icon="🎯" title="还没有面试记录" hint="选好方向开始第一场，或者来一轮完整的三轮战役。" />
        ) : (
          history.map((s) => (
            <motion.div
              key={s.id}
              className="history-row"
              layoutId={reduced ? undefined : `session-${s.id}`}
            >
              <span className={`chip ${s.status === 'done' ? 'go' : 'hold'}`}>{s.status === 'done' ? '已完成' : '进行中'}</span>
              <span className="strong">{s.direction}</span>
              {s.duration_min != null && <span className="chip none">{s.duration_min}分钟档</span>}
              <span className="muted">{fmtTime(s.created_at)}</span>
              <span className="muted">{s.jd_text ? '含目标JD' : '无JD（知识库出题）'}</span>
              <button
                className="btn small"
                onClick={() => ctx.openSessionById(s.id)}
              >
                {s.status === 'done' ? '查看报告' : '继续'}
              </button>
              <button
                className="btn small danger"
                disabled={delSession.isPending}
                onClick={() => {
                  if (!confirm('删除这场面试及其题库记录？不可恢复。')) return
                  delSession.mutate(s.id)
                }}
              >
                删除
              </button>
            </motion.div>
          ))
        )}
      </section>
    </div>
  )
}

let imgSeq = 0

/** v2.3-3 首页驾驶舱：形象问候 + 分数对比 + 当前短板 + 建议动作。 */
function CockpitCard(props: {
  stats: StatsSummary | null
  history: SessionInfo[]
  campaigns: CampaignInfo[]
  onContinueSession: () => void
  onContinueCampaign: (c: CampaignInfo) => void
  onOpenCampaign: (id: number) => void
  onStartFocused: (info: { direction: string; jd_text: null; jd_source: null; weak_points: string[] }) => void
}) {
  const { stats } = props
  const hour = new Date().getHours()
  const hello = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  const trend = stats?.trend ?? []
  const last = trend[trend.length - 1]
  const prev = trend[trend.length - 2]
  const delta =
    last?.avg != null && prev?.avg != null ? Math.round((last.avg - prev.avg) * 10) / 10 : null
  const runningCampaign = props.campaigns.find((c) => c.status === 'running')
  const weaknesses = (stats?.recent_weaknesses ?? []).slice(0, 3)
  const lastDone = props.history.find((s) => s.status === 'done')
  const weakest = stats?.type_stats?.[0]

  return (
    <section className="card cockpit">
      <div className="cockpit-greet">
        <img className="cockpit-avatar" src={avatarImg} alt="面试官" />
        <div className="cockpit-hello-wrap">
          <div className="cockpit-hello">{hello}，我是你的 AI 面试教练</div>
          <div className="muted">
            {stats?.done_sessions
              ? `已练 ${stats.done_sessions} 场 · 累计 ${stats.total_items} 题 · 总均分 ${stats.avg_score ?? '—'}`
              : '还没有开练——来第一场摸个底，我帮你定位短板。'}
          </div>
        </div>
        <div className="cockpit-score" title="最近一场均分">
          {stats?.done_sessions ? (
            <>
              <span className="cockpit-score-num">
                <CountUp value={last?.avg ?? null} decimals={1} />
              </span>
              <span className="muted">最近分</span>
              {delta != null && (
                <span className={`chip ${delta >= 0 ? 'go' : 'drop'}`}>
                  {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}
                  {prev?.avg != null ? `（上场 ${prev.avg}）` : ''}
                </span>
              )}
            </>
          ) : (
            <span className="muted">—</span>
          )}
        </div>
      </div>

      {stats == null ? (
        <Skeleton lines={3} />
      ) : (
        <>
          {weaknesses.length > 0 && (
            <div className="cockpit-weak">
              <span className="muted">当前短板：</span>
              {weaknesses.map((w, i) => (
                <span key={i} className="chip hold" title={w}>
                  {w.length > 14 ? w.slice(0, 14) + '…' : w}
                </span>
              ))}
            </div>
          )}

          <div className="cockpit-actions">
            {runningCampaign && (
              <button className="btn primary" onClick={() => props.onContinueCampaign(runningCampaign)}>
                ⚔️ 继续战役 第{Math.min(runningCampaign.current_round + 1, 3)}/3 轮（
                {CAMPAIGN_ROUND_NAMES[Math.min(runningCampaign.current_round, 2)]}）
              </button>
            )}
            {weaknesses.length > 0 && lastDone && (
              <button
                className="btn"
                onClick={() =>
                  props.onStartFocused({
                    direction: lastDone.direction,
                    jd_text: null,
                    jd_source: null,
                    weak_points: weaknesses,
                  })
                }
              >
                🎯 练专项：{weakest ? weakest.type : '薄弱项'}（4 题）
              </button>
            )}
            {props.history.some((s) => s.status === 'running') && (
              <button className="btn" onClick={props.onContinueSession}>
                ▶️ 继续进行中的面试
              </button>
            )}
            {!stats.done_sessions && <span className="muted">建议动作：从下方「开始面试」摸底第一场 ↓</span>}
            {stats.done_sessions > 0 && delta != null && delta < -1 && (
              <span className="muted">分数在下滑——先回看最近报告的三栏对比，再练专项。</span>
            )}
            {props.campaigns.some((c) => c.status === 'done') && (
              <button
                className="btn"
                onClick={() => props.onOpenCampaign(props.campaigns.find((c) => c.status === 'done')!.id)}
              >
                📋 回看上次战役评估
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}

/** 新建表单（单场 / 战役）。建会话走 SessionProvider 的流式入口；战役壳经 useMutation。
 * noProfile：无简历档案时置顶引导条并禁用开始（后端建会话必 404，提前拦截）。 */
function NewSessionCard(props: { noProfile?: boolean }) {
  const ctx = useInterviewSession()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [direction, setDirection] = useState('AI产品')
  const [mode, setMode] = useState<'single' | 'campaign'>('single')
  const [duration, setDuration] = useState<25 | 40>(25) // v2.4 时长档：默认 25 / 深挖 40（仅单场；战役固定 25）
  const [jdMode, setJdMode] = useState<'text' | 'image'>('text')
  const [jd, setJd] = useState('')
  const [jdSource, setJdSource] = useState<'text' | 'ocr'>('text')
  const [images, setImages] = useState<{ id: number; file: File; url: string }[]>([])
  const [dragover, setDragover] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<MsgBanner | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const createCampaign = useMutation({
    mutationFn: (body: { direction: string; jd_text: string | null; jd_source: string | null }) =>
      api<{ campaign: CampaignInfo }>('/api/interview/campaigns', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (d) => {
      setMsg(null)
      void qc.invalidateQueries({ queryKey: ['campaigns'] })
      // 战役壳建好 → 流式开启第 1 轮（HR面）
      ctx.startStreaming({
        direction: d.campaign.direction,
        jd_text: d.campaign.jd_text,
        jd_source: null,
        campaign_id: d.campaign.id,
        campaign_round: 1,
      })
    },
    onError: (e) => setMsg({ kind: 'error', text: `发起失败：${(e as Error).message}` }),
  })

  async function start() {
    if (props.noProfile) {
      setMsg({ kind: 'error', text: '请先上传简历——点上方「去上传简历」，面试官要读你的简历才能针对性出题' })
      return
    }
    if (!direction.trim()) {
      setMsg({ kind: 'error', text: '请先填写面试方向' })
      return
    }
    if (mode === 'single') {
      // v2.3-1：直接切到会话视图走流式建会话（开场逐字流出+分句播报，自动进入面试间）
      ctx.startStreaming({
        direction: direction.trim(),
        jd_text: jd || null,
        jd_source: jd ? jdSource : null,
        duration_min: duration,
      })
      return
    }
    // v2.3-3 面试战役：先建战役壳，再流式开启第 1 轮（HR面）
    setMsg({ kind: 'info', text: '正在发起三轮面试战役…' })
    createCampaign.mutate({ direction: direction.trim(), jd_text: jd || null, jd_source: jd ? jdSource : null })
  }

  function addFiles(list: FileList | File[]) {
    const next = [...images]
    const errs: string[] = []
    for (const f of Array.from(list)) {
      if (next.length >= 5) {
        errs.push('最多 5 张，已忽略多余图片')
        break
      }
      if (!f.type.startsWith('image/')) {
        errs.push(`「${f.name}」不是图片`)
        continue
      }
      if (f.size > 10 * 1024 * 1024) {
        errs.push(`「${f.name}」超过 10MB`)
        continue
      }
      next.push({ id: ++imgSeq, file: f, url: URL.createObjectURL(f) })
    }
    setImages(next)
    if (errs.length) setMsg({ kind: 'error', text: errs.join('；') })
    else setMsg(null)
  }

  function removeImage(id: number) {
    setImages((arr) => {
      const hit = arr.find((x) => x.id === id)
      if (hit) URL.revokeObjectURL(hit.url)
      return arr.filter((x) => x.id !== id)
    })
  }

  useEffect(() => {
    return () => images.forEach((x) => URL.revokeObjectURL(x.url))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 图片模式：window paste 监听（焦点在文本框时不拦截正常粘贴）
  useEffect(() => {
    if (jdMode !== 'image') return
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return
      const items = Array.from(e.clipboardData?.items ?? [])
      const imgs = items
        .filter((it) => it.type.startsWith('image/'))
        .map((it) => it.getAsFile())
        .filter(Boolean) as File[]
      if (imgs.length) {
        e.preventDefault()
        addFiles(imgs)
      } else {
        setMsg({ kind: 'error', text: '剪贴板里没有图片（截图后直接 Ctrl+V）' })
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jdMode, images])

  async function recognize() {
    if (!images.length) {
      setMsg({ kind: 'error', text: '请先添加 JD 截图' })
      return
    }
    setBusy(true)
    setMsg({ kind: 'info', text: '正在识别 JD 截图（约10-30秒）…' })
    try {
      const form = new FormData()
      images.forEach((x) => form.append('files', x.file, x.file.name))
      const d = await api<{ text: string }>('/api/interview/jd_ocr', { method: 'POST', body: form })
      setJd(d.text)
      setJdSource('ocr')
      setJdMode('text')
      setMsg({ kind: 'ok', text: '识别完成，已填入下方文本框——请核对补漏后开始面试' })
    } catch (e) {
      setMsg({ kind: 'error', text: `识别失败：${(e as Error).message}` })
    } finally {
      setBusy(false)
    }
  }

  const starting = createCampaign.isPending

  return (
    <section className="card">
      <h2>新的一轮训练</h2>
      {props.noProfile && (
        <p className="msg info" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>还没有简历档案——面试官需要读你的简历才能针对性出题。</span>
          <button className="btn small primary" onClick={() => navigate('/resume')}>
            去上传简历 →
          </button>
        </p>
      )}
      <div className="seg" style={{ marginBottom: 10 }}>
        <button className={`seg-btn${mode === 'single' ? ' active' : ''}`} onClick={() => setMode('single')} disabled={busy || starting}>
          单场模拟（时长驱动）
        </button>
        <button className={`seg-btn${mode === 'campaign' ? ' active' : ''}`} onClick={() => setMode('campaign')} disabled={busy || starting}>
          ⚔️ 面试战役（三轮递进）
        </button>
      </div>
      <p className="muted">
        {mode === 'single'
          ? '时长驱动的真实节奏面试：自我介绍 + 弹性话题深挖（追问引用你的原句、可跳回前话）+ 场景题 + 反问；作答有语音统计汇入报告。'
          : '针对目标岗位三轮递进：HR 面（动机与稳定性）→ 技术面（项目与技术深挖）→ 总监终面（商业思维与压力测试），难度逐轮升级；每轮约 25 分钟，三轮毕出综合评估与「可上战场」判断。'}
      </p>
      {mode === 'single' && (
        <div className="field">
          <span>目标时长（面试官按时间预算决定深挖与收尾节奏）</span>
          <div className="seg" style={{ marginBottom: 10 }}>
            <button
              className={`seg-btn${duration === 25 ? ' active' : ''}`}
              onClick={() => setDuration(25)}
              disabled={busy || starting}
            >
              25 分钟（默认）
            </button>
            <button
              className={`seg-btn${duration === 40 ? ' active' : ''}`}
              onClick={() => setDuration(40)}
              disabled={busy || starting}
            >
              40 分钟（深挖）
            </button>
          </div>
        </div>
      )}
      <label className="field">
        <span>面试方向（任意职业均可；未调研的方向 AI 会自动生成岗位画像，首次稍慢）</span>
        <input
          placeholder="如：Java 后端、新媒体运营、数据分析师…"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          disabled={busy || starting}
        />
      </label>
      <div className="quick-tags">
        {DIRECTIONS.filter((d) => d !== '其他').map((d) => (
          <button
            key={d}
            className={`btn small${direction === d ? ' primary' : ''}`}
            onClick={() => setDirection(d)}
            disabled={busy || starting}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="field">
        <span>目标岗位 JD（可选——出题更贴合；留空按方向知识库出题）</span>
        <div className="seg" style={{ marginBottom: 10 }}>
          <button className={`seg-btn${jdMode === 'text' ? ' active' : ''}`} onClick={() => setJdMode('text')} disabled={busy || starting}>
            文本粘贴
          </button>
          <button className={`seg-btn${jdMode === 'image' ? ' active' : ''}`} onClick={() => setJdMode('image')} disabled={busy || starting}>
            截图识别
          </button>
        </div>
        {jdMode === 'text' ? (
          <AutoTextarea
            value={jd}
            onChange={(v) => {
              setJd(v)
              if (!v) setJdSource('text')
            }}
            minRows={6}
            maxRows={14}
            maxWidthChars={40}
            placeholder={jdSource === 'ocr' ? '（已识别的 JD，可修改）' : '粘贴 JD 全文，或至少粘贴岗位职责与要求部分…'}
            disabled={busy || starting}
          />
        ) : (
          <>
            <div
              className={`dropzone${dragover ? ' dragover' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragover(true)
              }}
              onDragLeave={() => setDragover(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragover(false)
                if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
              }}
            >
              <div className="dz-icon">📷</div>
              <div>
                <b>点击选择</b> / 拖拽截图到此处 / 截图后直接 <b>Ctrl+V</b> 粘贴
              </div>
              <div className="muted">手机端点击调起相册；长 JD 可用长截屏，最多 5 张</div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files)
                e.target.value = ''
              }}
            />
            {images.length > 0 && (
              <div className="thumb-list">
                {images.map((x) => (
                  <div key={x.id} className="thumb">
                    <img src={x.url} alt={x.file.name} />
                    <button className="thumb-del" onClick={() => removeImage(x.id)} title="删除">
                      ×
                    </button>
                    <span className="thumb-name">{x.file.name}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn primary" onClick={recognize} disabled={busy || starting || !images.length}>
                {busy ? '识别中…' : `识别为文字（${images.length}张）`}
              </button>
            </div>
          </>
        )}
      </div>

      <button className="btn primary" onClick={start} disabled={busy || starting} style={{ marginTop: 6 }}>
        {starting ? '发起中…' : mode === 'single' ? '开始面试（进入沉浸面试间）' : '⚔️ 发起面试战役（第 1 轮 HR 面）'}
      </button>
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
    </section>
  )
}
