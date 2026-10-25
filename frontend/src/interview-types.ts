/** 面试域共享类型（D1 路由化拆分自原 InterviewPage.tsx，供首页/会话视图/战役视图/SessionProvider 共用）。 */

export const CAMPAIGN_ROUND_NAMES = ['HR面', '技术面', '总监终面']

export interface FocusInfo {
  campaign_id?: number | null
  campaign_round?: number | null
  weak_points?: string[] | null
}

export interface CampaignVerdict {
  ready: boolean
  level: string
  comment: string
  round_progression: string[]
  strengths: string[]
  risks: string[]
  action_plan: string[]
}

export interface CampaignRound {
  round: number
  name: string
  session_id: number
  status: 'running' | 'done'
  avg: number | null
  dimensions: Record<string, number> | null
  weaknesses: string[]
}

export interface CampaignInfo {
  id: number
  direction: string
  jd_text: string | null
  status: 'running' | 'done'
  current_round: number
  total_rounds: number
  round_names: string[]
  next_round: number | null
  rounds: CampaignRound[]
  verdict: CampaignVerdict | null
  created_at: string | null
  finished_at: string | null
}

export interface StatsSummary {
  done_sessions: number
  total_items: number
  avg_score: number | null
  type_stats: { type: string; avg: number; count: number }[]
  trend: { id: number; direction: string; date: string | null; avg: number | null }[]
  recent_weaknesses: string[]
}

export interface Msg {
  role: 'interviewer' | 'candidate'
  text: string
  meta?: {
    action?: string
    question_type?: string | null
    is_main_question?: boolean
    speech?: { duration_sec?: number; rate?: number; fillers?: number; complete?: number } | null
  } | null
}

export interface ReportItem {
  question_type: string
  question: string
  score: number
  comment: string
  key_points: string[]
  suggestions: string[]
  my_answer?: string
  model_answer?: string
}

export interface Report {
  overall_comment: string
  strengths: string[]
  weaknesses: string[]
  expression?: { comment: string; advice: string }
  dimensions?: Record<string, number> | null
  /** v2.6-1 五维固定权重加权的总分（后端确定性计算）；旧报告无 */
  overall_score?: number | null
  /** v2.6-1 一句话自证评分依据 */
  grading_notes?: string
  items: ReportItem[]
}

export interface SessionInfo {
  id: number
  direction: string
  jd_text: string | null
  status: 'running' | 'done'
  focused?: boolean
  duration_min?: number | null
  created_at: string | null
  finished_at: string | null
}

export interface SessionDetail extends SessionInfo {
  weak_points?: string[] | null
  focus?: FocusInfo | null
  messages: Msg[]
  report: Report | null
  state?: {
    main_count: number
    all_asked: boolean
    next_type: string | null
    followup_depth: number
    focused?: boolean
    mode?: string
    duration_min?: number
    elapsed_min?: number
    remaining_min?: number
  }
}

export interface PendingCreate {
  direction: string
  jd_text: string | null
  jd_source: string | null
  weak_points?: string[] | null
  campaign_id?: number | null
  campaign_round?: number | null
  /** v2.4 时长档：25 | 40；战役/专项不传 */
  duration_min?: number | null
}

export interface MsgBanner {
  kind: 'ok' | 'error' | 'info'
  text: string
}

export function fmtTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function scoreChip(score: number): string {
  if (score >= 8) return 'chip go'
  if (score >= 5) return 'chip hold'
  return 'chip drop'
}
