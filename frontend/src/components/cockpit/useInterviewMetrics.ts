/** 工作包 A2/A3：驾驶舱实时指标——全部从 messages 本地派生（零 API、零后端改动）。
 *  产出：语速折线点 / 填充词累计 / 完整度均值 / 话题树（含流式虚节点）/ 当前追问深度。
 */
import { useMemo } from 'react'
import type { Msg } from '../../interview-types'

export interface StreamMetaLite {
  action?: string
  question_type?: string | null
  is_main_question?: boolean
}

export interface FollowNode {
  msgIdx: number
  qtype: string | null
  pending?: boolean
}

export interface TopicNode {
  seq: number
  msgIdx: number
  qtype: string | null
  pending?: boolean
  followups: FollowNode[]
}

export interface RatePoint {
  msgIdx: number
  rate: number
}

export interface InterviewMetrics {
  /** 语速折线点（最近 12 条候选人作答，rate>0 才入图） */
  rates: RatePoint[]
  /** 填充词累计次数 */
  fillerTotal: number
  /** 句完整度均值 0-1（无数据为 null） */
  completeAvg: number | null
  /** 话题树节点（主问题 + 追问分支；msgIdx=-1 为流式进行中的虚节点） */
  topics: TopicNode[]
  /** 当前话题追问深度（0=主问题进行中） */
  depth: number
}

export function useInterviewMetrics(
  messages: Msg[],
  streamingMeta?: StreamMetaLite | null,
): InterviewMetrics {
  return useMemo(() => {
    const ratesAll: RatePoint[] = []
    let fillerTotal = 0
    let completeSum = 0
    let completeN = 0
    const topics: TopicNode[] = []

    messages.forEach((m, i) => {
      if (m.role === 'candidate') {
        const sp = m.meta?.speech
        if (sp) {
          if (sp.rate && sp.rate > 0) ratesAll.push({ msgIdx: i, rate: sp.rate })
          if (sp.fillers) fillerTotal += sp.fillers
          if (sp.complete != null) {
            completeSum += sp.complete
            completeN++
          }
        }
        return
      }
      // 面试官消息：主问题开新话题；其余（追问/收尾）记入当前话题分支
      if (m.meta?.is_main_question === true || topics.length === 0) {
        topics.push({ seq: topics.length + 1, msgIdx: i, qtype: m.meta?.question_type ?? null, followups: [] })
      } else {
        topics[topics.length - 1].followups.push({ msgIdx: i, qtype: m.meta?.question_type ?? null })
      }
    })

    // 流式中的下一句：虚节点——树随对话实时生长、深度提前可见
    if (streamingMeta) {
      if (streamingMeta.is_main_question === true || topics.length === 0) {
        topics.push({
          seq: topics.length + 1,
          msgIdx: -1,
          qtype: streamingMeta.question_type ?? null,
          pending: true,
          followups: [],
        })
      } else {
        topics[topics.length - 1].followups.push({
          msgIdx: -1,
          qtype: streamingMeta.question_type ?? null,
          pending: true,
        })
      }
    }

    const last = topics[topics.length - 1]
    return {
      rates: ratesAll.slice(-12),
      fillerTotal,
      completeAvg: completeN ? completeSum / completeN : null,
      topics,
      depth: last ? last.followups.length : 0,
    }
  }, [messages, streamingMeta])
}
