/** 会话视图（D1 拆分自原 InterviewPage.tsx）：对话流 + 作答 + 报告 + 战役推进。
 *  组件实例由路由外的 SessionRuntime 常驻挂载——本文件内的 SSE 流式、TTS 播报、
 *  语音互斥等时序逻辑保持原样，路由切换只改显隐、不卸载。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, apiStream, type StreamEvent } from '../api'
import AnswerInput from '../components/AnswerInput'
import InterviewRoom, { type RoomMsg } from '../components/InterviewRoom'
import RadarChart, { RadarLegend, RADAR_DIMS, radarColors, type RadarSeries } from '../components/RadarChart'
import SpeechStrip from '../components/SpeechStrip'
import { CountUp } from '../components/ui'
import { bubbleIn, motion, popItem, riseItem, staggerContainer, useReducedMotion } from '../motion'
import { analyzeSpeech, toSpeechMeta, type SpeechStat } from '../speech-analysis'
import { SentenceBuffer, useSpeaker } from '../tts'
import { useInterviewSession } from '../session'
import {
  CAMPAIGN_ROUND_NAMES,
  scoreChip,
  type CampaignInfo,
  type Msg,
  type MsgBanner,
  type PendingCreate,
  type Report,
  type ReportItem,
  type SessionDetail,
} from '../interview-types'
import avatarImg from '../assets/interviewer-256.png'

type TurnMeta = NonNullable<StreamEvent['turn_meta']> | null

export default function SessionView(props: {
  session: SessionDetail | null
  pending: PendingCreate | null
  autoSpeakFirst: boolean
}) {
  const ctx = useInterviewSession()
  const [cur, setCur] = useState<SessionDetail | null>(props.session)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState<'answer' | 'end' | null>(null)
  const [msg, setMsg] = useState<MsgBanner | null>(null)
  const [streamingText, setStreamingText] = useState<string | null>(null)
  const [streamingMeta, setStreamingMeta] = useState<TurnMeta>(null)
  const [thinking, setThinking] = useState(false)
  const [reportStage, setReportStage] = useState(false)
  const [roomOpen, setRoomOpen] = useState(props.pending !== null)
  const [stats, setStats] = useState<Record<number, SpeechStat>>({})
  const chatRef = useRef<HTMLDivElement>(null)
  const speaker = useSpeaker()
  // v2.3-1 本地计时：pending 建会话时面试间计时器的起点
  const [localStart] = useState(() => new Date().toISOString())
  // 作答计时（表达分析用）：从开始输入/说话到提交
  const answerStartRef = useRef<number | null>(null)
  // 流式作答期间的本地候选人消息（后端 done 才落库，乐观显示）
  const optimisticRef = useRef<Msg | null>(null)
  const startedRef = useRef(false)
  // 已播报到的消息数：流式路径分句即译已完成播报；整体降级路径由 effect 接管自动播报
  const spokenCountRef = useRef(
    props.autoSpeakFirst && props.session ? props.session.messages.length - 1 : (props.session?.messages.length ?? 0),
  )

  function apply(d: SessionDetail) {
    setCur(d)
    if (d.status === 'done') setAnswer('')
  }

  // v2.3-1 流式建会话：meta → delta*（打字机+分句TTS）→ done；失败降级整体接口
  async function createStreaming(info: PendingCreate) {
    setThinking(true)
    setMsg({ kind: 'info', text: '面试官正在准备开场（未调研方向会先生成岗位画像，稍慢）…' })
    let text = ''
    // 用对象持有结果：避免 TS 对闭包内赋值做 never 窄化
    const result: { session: SessionDetail | null } = { session: null }
    let errMsg: string | null = null
    const sb = new SentenceBuffer((s) => speaker.enqueue(s, 'live'))
    try {
      await apiStream('/api/interview/sessions/stream', info, (ev) => {
        if (ev.type === 'meta') setStreamingMeta(ev.turn_meta ?? null)
        else if (ev.type === 'delta') {
          text += ev.text ?? ''
          setStreamingText(text)
          sb.push(ev.text ?? '')
          setMsg(null)
        } else if (ev.type === 'error') errMsg = ev.message ?? '启动失败'
        else if (ev.type === 'done') result.session = ev.session as SessionDetail
      })
    } catch (e) {
      errMsg = (e as Error).message
    }
    sb.flush()
    if (result.session) {
      const doneSession = result.session
      apply(doneSession)
      ctx.handleLoaded(doneSession)
      spokenCountRef.current = doneSession.messages.length // 已边生成边播，不重复播
      setStreamingText(null)
      setStreamingMeta(null)
      setThinking(false)
      setMsg(null)
      return
    }
    // 降级：整体接口重建（流式端点失败时已清理半建会话，无脏数据）
    setMsg({ kind: 'info', text: '流式启动失败，正在降级为整体模式…' })
    speaker.stop()
    try {
      const d = await api<{ session: SessionDetail }>('/api/interview/sessions', {
        method: 'POST',
        body: JSON.stringify(info),
      })
      apply(d.session)
      ctx.handleLoaded(d.session)
      spokenCountRef.current = d.session.messages.length - 1 // 整体模式由自动播报 effect 接管开场
    } catch (e) {
      setMsg({ kind: 'error', text: `开始失败：${errMsg ?? (e as Error).message}。请返回列表重试。` })
    } finally {
      setStreamingText(null)
      setStreamingMeta(null)
      setThinking(false)
    }
  }

  useEffect(() => {
    if (props.pending && !startedRef.current) {
      startedRef.current = true
      void createStreaming(props.pending)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pending])

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
  }, [cur?.messages.length, streamingText, cur?.status])

  // 整体降级路径：新到达的面试官消息自动播报（流式路径已把 spokenCountRef 推平）
  useEffect(() => {
    const msgs = cur?.messages ?? []
    if (msgs.length > spokenCountRef.current) {
      const idx = msgs.length - 1
      const last = msgs[idx]
      spokenCountRef.current = msgs.length
      if (last.role === 'interviewer') speaker.speak(last.text, `msg-${idx}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.messages])

  function handleAnswerChange(v: string) {
    if (!answerStartRef.current && v.trim()) answerStartRef.current = Date.now()
    if (!v.trim()) answerStartRef.current = null
    setAnswer(v)
  }

  async function submitAnswer() {
    if (!cur) return
    const text = answer.trim()
    if (text.length < 5) {
      setMsg({ kind: 'error', text: '回答太短，请像面试口述一样作答' })
      return
    }
    const prevLen = cur.messages.length
    const durationSec = answerStartRef.current ? Math.round((Date.now() - answerStartRef.current) / 1000) : 0
    const stat = analyzeSpeech(text, durationSec)
    if (stat) setStats((prev) => ({ ...prev, [prevLen]: stat }))
    const speechMeta = stat ? toSpeechMeta(stat) : null
    optimisticRef.current = { role: 'candidate', text, meta: { speech: speechMeta } }
    setBusy('answer')
    setThinking(true)
    setMsg({ kind: 'info', text: '面试官思考中（流式输出，边生成边播报）…' })
    let full = ''
    let gotDelta = false
    // 用对象持有结果：避免 TS 对闭包内赋值做 never 窄化
    const result: { session: SessionDetail | null } = { session: null }
    let errMsg: string | null = null
    const sb = new SentenceBuffer((s) => speaker.enqueue(s, 'live'))
    try {
      await apiStream(`/api/interview/sessions/${cur.id}/answer/stream`, { text, speech: speechMeta }, (ev) => {
        if (ev.type === 'meta') setStreamingMeta(ev.turn_meta ?? null)
        else if (ev.type === 'delta') {
          gotDelta = true
          full += ev.text ?? ''
          setStreamingText(full)
          sb.push(ev.text ?? '')
          setMsg(null)
        } else if (ev.type === 'status') {
          setReportStage(true)
          if (ev.message) setMsg({ kind: 'info', text: ev.message })
        } else if (ev.type === 'error') errMsg = ev.message ?? '响应失败'
        else if (ev.type === 'done') result.session = ev.session as SessionDetail
      })
    } catch (e) {
      errMsg = (e as Error).message
    }
    sb.flush()
    if (result.session) {
      const doneSession = result.session
      optimisticRef.current = null
      apply(doneSession)
      ctx.handleLoaded(doneSession)
      spokenCountRef.current = doneSession.messages.length
      setAnswer('')
      answerStartRef.current = null
      setStreamingText(null)
      setStreamingMeta(null)
      setThinking(false)
      setReportStage(false)
      setBusy(null)
      setMsg(null)
      return
    }
    // 失败恢复：不出字 → 降级整体作答接口；已出字 → 提示重试（回答保留）
    speaker.stop()
    optimisticRef.current = null
    setStreamingText(null)
    setStreamingMeta(null)
    setThinking(false)
    setReportStage(false)
    if (!gotDelta) {
      try {
        const d = await api<{ session: SessionDetail }>(`/api/interview/sessions/${cur.id}/answer`, {
          method: 'POST',
          body: JSON.stringify({ text, speech: speechMeta }),
        })
        apply(d.session)
        ctx.handleLoaded(d.session)
        setAnswer('')
        answerStartRef.current = null
        setBusy(null)
        setMsg(null)
        return
      } catch (e2) {
        setMsg({ kind: 'error', text: `提交失败：${errMsg ?? (e2 as Error).message}` })
        setBusy(null)
        return
      }
    }
    setBusy(null)
    setMsg({ kind: 'error', text: `流式中断：${errMsg ?? '连接异常'}。你的回答仍保留在输入框，可直接重试提交。` })
  }

  async function endInterview() {
    if (!cur || !confirm('确定结束面试并生成报告？')) return
    setBusy('end')
    setReportStage(true)
    setMsg({ kind: 'info', text: '报告生成中（约30-90秒，请勿关闭页面）…' })
    try {
      const d = await api<{ session: SessionDetail }>(`/api/interview/sessions/${cur.id}/end`, { method: 'POST' })
      apply(d.session)
      ctx.handleLoaded(d.session)
      setMsg(null)
    } catch (e) {
      setMsg({ kind: 'error', text: `结束失败：${(e as Error).message}` })
    } finally {
      setBusy(null)
      setReportStage(false)
    }
  }

  // v2.3-3 战役轮次推进：本轮报告出来后，登记完成并开下一轮 / 生成综合评估
  const campaignFocus = cur?.focus?.campaign_round ? cur.focus : null
  const [advancing, setAdvancing] = useState(false)
  async function advanceCampaign() {
    if (!campaignFocus?.campaign_id || !cur) return
    setAdvancing(true)
    setMsg({ kind: 'info', text: campaignFocus.campaign_round! < 3 ? '正在登记本轮成绩并准备下一轮…' : '三轮已齐，综合评估生成中（约30-90秒）…' })
    try {
      const d = await api<{ campaign: CampaignInfo }>(`/api/interview/campaigns/${campaignFocus.campaign_id}/advance`, {
        method: 'POST',
        body: JSON.stringify({ session_id: cur.id }),
      })
      setMsg(null)
      ctx.handleCampaignAdvanced(d.campaign)
    } catch (e) {
      setMsg({ kind: 'error', text: `推进失败：${(e as Error).message}` })
    } finally {
      setAdvancing(false)
    }
  }

  // 展示消息：流式作答期间乐观拼上本地候选人消息
  const displayMessages = useMemo<Msg[]>(() => {
    const base = cur?.messages ?? []
    if (optimisticRef.current && streamingText !== null) return [...base, optimisticRef.current]
    return base
  }, [cur?.messages, streamingText])

  // C4：面试官气泡逐条入场——只对挂载后新到的消息播放（恢复/回看会话时不重放整屏）
  const reduced = useReducedMotion()
  const [msgMountLen] = useState(() => props.session?.messages.length ?? 0)

  const running = cur?.status === 'running'
  const durationMin = cur?.duration_min ?? props.pending?.duration_min ?? null
  const campaignRound = campaignFocus?.campaign_round ?? props.pending?.campaign_round ?? null
  const roundLabel = campaignRound ? `战役第${campaignRound}轮·${CAMPAIGN_ROUND_NAMES[campaignRound - 1] ?? ''}` : null
  const isFocused = !!(cur?.focused || roundLabel || (props.pending?.weak_points?.length ?? 0) > 0)
  const isDuration = !!durationMin && !(props.pending?.weak_points?.length ?? 0) && !cur?.focus?.weak_points
  const mainTotal = isFocused ? 4 : 7
  const progress = isDuration
    ? `${cur?.state ? `话题 ${cur.state.main_count}` : '…'}${cur?.state?.remaining_min != null ? ` · 剩 ${Math.max(0, Math.round(cur.state.remaining_min))} 分` : ''}`
    : cur?.state
      ? `${cur.state.main_count}/${mainTotal}`
      : '…'
  const headerTitle = roundLabel
    ? `${cur?.direction ?? props.pending?.direction ?? ''} · ${roundLabel}`
    : (cur?.direction ?? props.pending?.direction ?? '') +
      (isFocused ? ' · 薄弱项专项训练' : isDuration ? ` · 模拟面试（${durationMin} 分钟档）` : ' · 模拟面试')

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h2>
            {headerTitle}{' '}
            {running && cur?.state && (
              <span className="muted">（进度 {progress}{!isFocused && cur.state.next_type ? ` · 下一题：${cur.state.next_type}` : ''}）</span>
            )}
            {thinking && !streamingText && <span className="muted">（面试官准备中…）</span>}
          </h2>
          <div className="btn-row">
            {running && (
              <button className="btn" onClick={() => setRoomOpen(true)} disabled={busy !== null}>
                🖥 进入面试间
              </button>
            )}
            <button className="btn" onClick={ctx.exitSession} disabled={busy !== null}>
              {running ? '暂离（可回来继续）' : '返回列表'}
            </button>
            {running && (
              <button className="btn danger" onClick={endInterview} disabled={busy !== null}>
                {busy === 'end' ? '报告中…' : '结束面试'}
              </button>
            )}
          </div>
        </div>
        {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}

        {speaker.supported && (
          <div className="voice-bar">
            <label className="voice-toggle">
              <input
                type="checkbox"
                checked={speaker.enabled}
                onChange={(e) => {
                  speaker.setEnabled(e.target.checked)
                  if (!e.target.checked) speaker.stop()
                }}
              />
              🔊 面试官播报
            </label>
            <label className="voice-rate" title="语速">
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
            {speaker.speaking && <span className="muted">播报中，麦克风已暂停（防自听）</span>}
            {speaker.failed && (
              <button className="tts-retry" onClick={speaker.retry}>
                ⚠ 语音暂时不可用，点击重试
              </button>
            )}
            <span className="muted voice-hint">点击面试官的话可重听</span>
          </div>
        )}

        <div className="chat-box" ref={chatRef}>
          {displayMessages.map((m, i) => (
            <motion.div
              key={i}
              className={`bubble-row ${m.role}`}
              variants={bubbleIn}
              initial={!reduced && m.role === 'interviewer' && i >= msgMountLen ? 'initial' : false}
              animate="animate"
            >
              {m.role === 'interviewer' && <img className="bubble-avatar" src={avatarImg} alt="" draggable={false} />}
              <div
                className={
                  'bubble ' +
                  m.role +
                  (m.role === 'interviewer' ? ' speakable' : '') +
                  (m.role === 'interviewer' && speaker.speaking && speaker.playingTag === `msg-${i}` ? ' playing' : '')
                }
                onClick={
                  m.role === 'interviewer'
                    ? () => {
                        if (speaker.speaking && speaker.playingTag === `msg-${i}`) speaker.stop()
                        else speaker.speak(m.text, `msg-${i}`)
                      }
                    : undefined
                }
              >
                {m.role === 'interviewer' && m.meta?.question_type && (
                  <div className="bubble-tag">
                    {m.meta.is_main_question ? `主问题 · ${m.meta.question_type}` : `追问 · ${m.meta.question_type}`}
                  </div>
                )}
                <div className="bubble-text">{m.text}</div>
                {m.role === 'candidate' && (stats[i] || m.meta?.speech) && (
                  <SpeechStrip
                    data={
                      stats[i]
                        ? {
                            rate: stats[i].rate,
                            fillers: stats[i].fillerTotal,
                            complete: stats[i].completeRate,
                            chars: stats[i].chars,
                          }
                        : m.meta?.speech ?? undefined
                    }
                  />
                )}
              </div>
            </motion.div>
          ))}
          {streamingText !== null && (
            <motion.div
              className="bubble-row interviewer"
              variants={bubbleIn}
              initial={reduced ? false : 'initial'}
              animate="animate"
            >
              <img className="bubble-avatar" src={avatarImg} alt="" draggable={false} />
              <div className="bubble interviewer speakable">
                {streamingMeta?.question_type && (
                  <div className="bubble-tag">
                    {streamingMeta.is_main_question
                      ? `主问题 · ${streamingMeta.question_type}`
                      : `追问 · ${streamingMeta.question_type}`}
                  </div>
                )}
                <div className="bubble-text">
                  {streamingText}
                  <span className="stream-cursor" />
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {running && cur ? (
          <>
            <AnswerInput
              value={answer}
              onChange={handleAnswerChange}
              rows={4}
              placeholder="像面试口述一样作答（可语音、可修改，点提交发送）"
              disabled={busy !== null}
              muted={speaker.speaking}
            />
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={submitAnswer} disabled={busy !== null}>
                {busy === 'answer' ? '面试官思考中…' : '提交回答'}
              </button>
            </div>
          </>
        ) : (
          !running &&
          cur && <p className="msg ok">面试已结束，报告如下。</p>
        )}
        {!cur && props.pending && thinking && streamingText === null && (
          <p className="msg info">面试官正在准备开场，马上逐字流出…</p>
        )}
      </section>

      {!running && cur?.report && (
        <ReportCard
          report={cur.report}
          focused={isFocused}
          onStartFocused={
            cur.direction && !campaignRound
              ? (wps) =>
                  ctx.startStreaming({
                    direction: cur.direction,
                    jd_text: cur.jd_text,
                    jd_source: null,
                    weak_points: wps,
                  })
              : undefined
          }
        />
      )}

      {/* v2.3-3 战役轮次推进：本轮报告已出 → 进入下一轮 / 生成综合评估 */}
      {!running && cur?.report && campaignRound && campaignFocus?.campaign_id && (
        <section className="card">
          <h2>面试战役进度</h2>
          <p className="muted">
            已完成第 {campaignRound}/3 轮（{CAMPAIGN_ROUND_NAMES[campaignRound - 1]}）
            {campaignRound < 3
              ? `，下一轮：${CAMPAIGN_ROUND_NAMES[campaignRound]}——难度与侧重升级。`
              : '，三轮已齐，生成综合评估与「可上战场」判断。'}
          </p>
          <button className="btn primary" onClick={advanceCampaign} disabled={advancing}>
            {advancing
              ? '处理中…'
              : campaignRound < 3
                ? `⚔️ 进入第 ${campaignRound + 1} 轮（${CAMPAIGN_ROUND_NAMES[campaignRound]}）→`
                : '🧾 生成综合评估 →'}
          </button>
        </section>
      )}

      {roomOpen && (cur || props.pending) && (
        <InterviewRoom
          direction={cur?.direction ?? props.pending?.direction ?? ''}
          createdAt={cur?.created_at ?? localStart}
          mainCount={cur?.state?.main_count ?? 0}
          nextType={cur?.state?.next_type ?? (isFocused ? (roundLabel ? '战役进行中' : '专项训练') : '自我介绍')}
          focused={isFocused}
          roundLabel={roundLabel ?? undefined}
          durationMin={isDuration ? durationMin : null}
          done={cur?.status === 'done'}
          messages={displayMessages as RoomMsg[]}
          stats={stats}
          streamingText={streamingText}
          streamingMeta={streamingMeta}
          thinking={thinking}
          reportStage={reportStage}
          speaker={speaker}
          answer={answer}
          onAnswerChange={handleAnswerChange}
          onSubmit={submitAnswer}
          onEnd={endInterview}
          onExit={() => setRoomOpen(false)}
          busy={!cur || busy !== null ? (busy ?? 'answer') : null}
        />
      )}
    </div>
  )
}

/** 报告五维雷达：优先 LLM dimensions；旧报告/缺失时按逐题均分估算（扁平五边形）。 */
function reportRadarSeries(report: Report): { series: RadarSeries[]; estimated: boolean } {
  const scores = report.items.map((it) => it.score)
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
  if (report.dimensions && RADAR_DIMS.every((d) => typeof report.dimensions?.[d] === 'number')) {
    return {
      series: [{ name: '本场', values: RADAR_DIMS.map((d) => report.dimensions![d]), color: radarColors(1)[0] }],
      estimated: false,
    }
  }
  return { series: [{ name: '本场（估算）', values: RADAR_DIMS.map(() => avg), color: radarColors(1)[0] }], estimated: true }
}

/** 逐题三栏对比：我的回答 ｜ 参考要点 ｜ AI 优化示范（v2.3-2）。 */
function CompareBlock(props: { item: ReportItem }) {
  const { item } = props
  return (
    <div className="compare-grid">
      <div className="compare-col mine">
        <h5>我的回答</h5>
        <p className="notes">{item.my_answer || '（本场未记录到回答原文）'}</p>
      </div>
      <div className="compare-col points">
        <h5>参考要点</h5>
        {item.key_points.length > 0 ? (
          <ul className="req-list">
            {item.key_points.map((k, j) => (
              <li key={j}>{k}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">（无）</p>
        )}
      </div>
      <div className="compare-col model">
        <h5>AI 优化示范</h5>
        {item.model_answer ? <p className="notes">{item.model_answer}</p> : <p className="muted">（本场报告未生成示范回答）</p>}
      </div>
    </div>
  )
}

function ReportItemCard(props: { item: ReportItem; index: number }) {
  const { item, index } = props
  const [cmpOpen, setCmpOpen] = useState(false)
  const hasCompare = !!(item.my_answer || item.model_answer || item.key_points.length)
  return (
    // C3：逐题 stagger 入场由父级 staggerContainer 驱动（variants 继承）
    <motion.div className="qa-card answered report-item" variants={riseItem}>
      <div className="qa-head">
        <span className="chip none">{item.question_type}</span>
        <span className={scoreChip(item.score)}>{item.score} 分</span>
        <span className="muted">#{index + 1}</span>
      </div>
      <div className="qa-question">{item.question}</div>
      {item.comment && <p className="reason">{item.comment}</p>}
      <div className="btn-row" style={{ margin: '6px 0' }}>
        {hasCompare && (
          <button className="btn small" onClick={() => setCmpOpen(!cmpOpen)}>
            {cmpOpen ? '▲ 收起三栏对比' : '📋 三栏答案对比'}
          </button>
        )}
      </div>
      {cmpOpen && <CompareBlock item={item} />}
      {item.suggestions.length > 0 && (
        <>
          <h4>改进建议</h4>
          <ul className="gap-list">
            {item.suggestions.map((s, j) => (
              <li key={j}>{s}</li>
            ))}
          </ul>
        </>
      )}
    </motion.div>
  )
}

function ReportCard(props: {
  report: Report
  focused?: boolean
  onStartFocused?: (weakPoints: string[]) => void
}) {
  const { report } = props
  const reduced = useReducedMotion()
  const { series, estimated } = useMemo(() => reportRadarSeries(report), [report])
  // C3：本场总分（逐题均分）数字滚动
  const scores = report.items.map((it) => it.score).filter((v) => Number.isFinite(v))
  const avgScore = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null
  return (
    <section className="card">
      <div className="card-head">
        <h2>{props.focused ? '专项训练报告' : '面试报告'}</h2>
        {avgScore != null && (
          <div className="report-score" title="本场总分（逐题均分）">
            <span className="report-score-num">
              <CountUp value={avgScore} decimals={1} />
            </span>
            <span className="muted">本场总分</span>
          </div>
        )}
      </div>
      {report.overall_comment && <p className="reason">{report.overall_comment}</p>}

      {/* v2.6-1 评分依据自证：折叠展示，提升对分数的信任感 */}
      {report.grading_notes && (
        <details className="grading-notes">
          <summary className="muted">评分依据（AI 自证）</summary>
          <p className="notes">{report.grading_notes}</p>
        </details>
      )}

      <div className="radar-box">
        <RadarChart series={series} />
        <RadarLegend series={series} />
        {estimated && <p className="muted" style={{ fontSize: 12 }}>旧版报告无五维评分，按逐题均分估算</p>}
      </div>

      {report.strengths.length > 0 && (
        <>
          <h4>亮点</h4>
          <ul className="req-list">
            {report.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </>
      )}
      {report.weaknesses.length > 0 && (
        <>
          <h4>薄弱项</h4>
          {/* C3：薄弱项标签弹入（stagger + spring；reduced-motion 直接静态） */}
          <motion.ul
            className="gap-list"
            variants={staggerContainer}
            initial={reduced ? false : 'initial'}
            animate="animate"
          >
            {report.weaknesses.map((s, i) => (
              <motion.li key={i} variants={popItem}>
                {s}
              </motion.li>
            ))}
          </motion.ul>
          {props.onStartFocused && (
            <button
              className="btn primary"
              style={{ margin: '4px 0 8px' }}
              onClick={() => props.onStartFocused?.(report.weaknesses)}
            >
              🎯 薄弱项专项训练（4 题·只练短板）
            </button>
          )}
        </>
      )}
      {report.expression && (report.expression.comment || report.expression.advice) && (
        <>
          <h4>表达维度（语音统计）</h4>
          {report.expression.comment && <p className="reason">{report.expression.comment}</p>}
          {report.expression.advice && <p className="muted">建议：{report.expression.advice}</p>}
        </>
      )}
      <h3>逐题评分</h3>
      {/* C3：逐题卡片 stagger 入场（子项 ReportItemCard 根为 riseItem variants） */}
      <motion.div variants={staggerContainer} initial={reduced ? false : 'initial'} animate="animate">
        {report.items.map((it, i) => (
          <ReportItemCard key={i} item={it} index={i} />
        ))}
      </motion.div>
    </section>
  )
}
