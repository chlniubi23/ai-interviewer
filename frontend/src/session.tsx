/** D1 活动会话容器：把「进行中的面试」（SessionView 实例、SSE 流、TTS 播报）提升到路由之外。
 *
 * 设计要点：
 * - SessionView 常驻挂载在 SessionRuntime 里，路由只控制显隐（display:none）——
 *   面试进行中切到 /bank 再切回 /session/:id，SSE 流式链路、播报队列、作答状态全部不丢。
 * - /session/:id 刷新或直达时，Gate 经 GET /api/interview/sessions/:id 恢复该会话。
 * - 新建（pending）走 /session/new，流式建会话完成后 replace 到真实 /session/:id。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { Skeleton } from './components/ui'
import { motion, useReducedMotion } from './motion'
import type { CampaignInfo, PendingCreate, SessionDetail } from './interview-types'
import SessionView from './pages/SessionView'

interface InterviewSessionCtxValue {
  session: SessionDetail | null
  pending: PendingCreate | null
  autoSpeak: boolean
  /** 每次 openSession/startStreaming 递增，强制 SessionView 重挂载（清空旧会话状态）。 */
  seq: number
  /** 打开一个已存在的会话（navigate 默认 true；Gate 恢复时传 false，避免重复跳转）。 */
  openSession: (s: SessionDetail, opts?: { navigate?: boolean; autoSpeak?: boolean }) => void
  /** 列表入口：跳 /session/:id，由 Gate 拉取详情（命中活动会话时零请求直达）。 */
  openSessionById: (id: number) => void
  /** 流式新建会话（单场/专项/战役下一轮共用）：挂 pending 并跳 /session/new。 */
  startStreaming: (info: PendingCreate) => void
  /** 暂离/返回列表：卸载活动会话（与改造前 onExit 语义一致），回首页并刷新列表缓存。 */
  exitSession: () => void
  /** SessionView 每次拿到权威会话快照（流式 done / 整体降级 / end）时回调。 */
  handleLoaded: (s: SessionDetail) => void
  /** 战役推进：收官 → 跳综合评估；否则流式开下一轮。 */
  handleCampaignAdvanced: (c: CampaignInfo) => void
}

const Ctx = createContext<InterviewSessionCtxValue | null>(null)

export function useInterviewSession(): InterviewSessionCtxValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useInterviewSession 必须在 SessionProvider 内使用')
  return v
}

export function SessionProvider(props: { children: ReactNode }) {
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [pending, setPending] = useState<PendingCreate | null>(null)
  const [autoSpeak, setAutoSpeak] = useState(false)
  const [seq, setSeq] = useState(0)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const invalidateLists = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['sessions'] })
    void qc.invalidateQueries({ queryKey: ['stats'] })
    void qc.invalidateQueries({ queryKey: ['campaigns'] })
  }, [qc])

  const openSession = useCallback(
    (s: SessionDetail, opts?: { navigate?: boolean; autoSpeak?: boolean }) => {
      setPending(null)
      setSession(s)
      setSeq((n) => n + 1)
      setAutoSpeak(opts?.autoSpeak ?? false)
      if (opts?.navigate !== false) navigate(`/session/${s.id}`)
    },
    [navigate],
  )

  const openSessionById = useCallback(
    (id: number) => {
      navigate(`/session/${id}`)
    },
    [navigate],
  )

  const startStreaming = useCallback(
    (info: PendingCreate) => {
      setSession(null)
      setPending(info)
      setSeq((n) => n + 1)
      setAutoSpeak(false)
      navigate('/session/new')
    },
    [navigate],
  )

  const exitSession = useCallback(() => {
    setSession(null)
    setPending(null)
    invalidateLists()
    navigate('/')
  }, [invalidateLists, navigate])

  const handleLoaded = useCallback(
    (s: SessionDetail) => {
      setSession(s)
      invalidateLists()
      // 新建流式完成：/session/new → 真实 id（replace，不留无法恢复的中间历史）
      navigate(`/session/${s.id}`, { replace: true })
    },
    [invalidateLists, navigate],
  )

  const handleCampaignAdvanced = useCallback(
    (camp: CampaignInfo) => {
      invalidateLists()
      void qc.invalidateQueries({ queryKey: ['campaign', String(camp.id)] })
      if (camp.status === 'done') {
        setSession(null)
        setPending(null)
        navigate(`/campaign/${camp.id}`)
      } else {
        startStreaming({
          direction: camp.direction,
          jd_text: camp.jd_text,
          jd_source: null,
          campaign_id: camp.id,
          campaign_round: camp.next_round,
        })
      }
    },
    [invalidateLists, navigate, qc, startStreaming],
  )

  const value: InterviewSessionCtxValue = {
    session,
    pending,
    autoSpeak,
    seq,
    openSession,
    openSessionById,
    startStreaming,
    exitSession,
    handleLoaded,
    handleCampaignAdvanced,
  }

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

/** 常驻挂载的活动会话运行时 + 路由 Gate（恢复 / 直达 / 刷新）。
 *  由 App 渲染在 <main className="content"> 内（Routes 之外），保证路由切换不卸载。 */
export function SessionRuntime() {
  const ctx = useInterviewSession()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const m = matchPath('/session/:id', pathname)
  const idParam = m?.params.id ?? null
  const routeId = idParam != null && /^\d+$/.test(idParam) ? Number(idParam) : null
  const restoringRef = useRef<number | null>(null)
  const { openSession } = ctx

  // Gate：落在 /session/:id 但活动会话不是它 → 拉 GET 恢复；失败回首页
  useEffect(() => {
    if (routeId == null) return
    if (ctx.session?.id === routeId) return
    if (ctx.pending) return // 新建流式进行中：不抢路由，等 done 后 replace 到真实 id
    if (restoringRef.current === routeId) return // StrictMode 双跑防抖
    restoringRef.current = routeId
    api<{ session: SessionDetail }>(`/api/interview/sessions/${routeId}`)
      .then((d) => openSession(d.session, { navigate: false, autoSpeak: false }))
      .catch((e) => {
        alert(`读取会话失败：${(e as Error).message}`)
        navigate('/', { replace: true })
      })
      .finally(() => {
        restoringRef.current = null
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, ctx.session?.id, ctx.pending, openSession, navigate])

  // 直达 /session/new 但没有 pending（刷新/手输地址）→ 回首页
  useEffect(() => {
    if (idParam === 'new' && !ctx.pending && !ctx.session) navigate('/', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam, ctx.pending, ctx.session, navigate])

  const active = ctx.session !== null || ctx.pending !== null
  const onSessionRoute = m !== null
  const reduced = useReducedMotion()

  if (!active) {
    // /session/:id 恢复中的占位（其余路由不渲染任何东西）
    return onSessionRoute ? <Skeleton lines={4} /> : null
  }

  // C1/C2：进入会话路由时淡入；layoutId 与首页会话行共享元素（仅路由可见时注册，
  // 避免常驻挂载的隐藏实例与首页行 layoutId 冲突）。reduced-motion 下静态呈现。
  return (
    <motion.div
      key={ctx.seq}
      className={onSessionRoute ? undefined : 'page-hidden'}
      layoutId={!reduced && onSessionRoute && ctx.session ? `session-${ctx.session.id}` : undefined}
      initial={reduced || !onSessionRoute ? false : { opacity: 0 }}
      animate={onSessionRoute ? { opacity: 1 } : undefined}
      transition={{ duration: 0.2 }}
    >
      <SessionView
        key={ctx.seq}
        session={ctx.session}
        pending={ctx.pending}
        autoSpeakFirst={ctx.autoSpeak}
      />
    </motion.div>
  )
}
