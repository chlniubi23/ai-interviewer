/** 工作包 A3：话题树（SVG，驾驶舱左栏）。
 *  主问题 = 纵向大节点（序号 + 题型），每个追问 = 向右生长的分支节点，随对话实时生长；
 *  当前进行节点呼吸高亮；点击节点滚动定位到对应消息气泡（activeMsgIdx 反向同步 = 双向导航）。
 */
import { useEffect, useMemo, useRef } from 'react'
import type { TopicNode } from './useInterviewMetrics'

const ROW_H = 46
const MAIN_X = 30
const FOLLOW_X = 108
const R_MAIN = 13
const R_FOL = 7
const W = 246

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

export default function TopicTree(props: {
  topics: TopicNode[]
  /** scroll-spy：视口顶部附近的消息下标；null=跟随最新；-1=流式中（高亮虚节点） */
  activeMsgIdx: number | null
  onSelect: (msgIdx: number) => void
}) {
  const { topics, activeMsgIdx, onSelect } = props
  const boxRef = useRef<HTMLDivElement>(null)

  // 行布局：主问题占一行，其追问依次占后续行（向右偏移）
  const layout = useMemo(() => {
    let row = 0
    return topics.map((topic) => {
      const mainRow = row++
      const folRows = topic.followups.map(() => row++)
      return { topic, mainRow, folRows }
    })
  }, [topics])

  // 新节点生长时滚到底部（跟随面试推进）
  const prevCountRef = useRef(0)
  useEffect(() => {
    const n = topics.reduce((a, t) => a + 1 + t.followups.length, 0)
    if (n > prevCountRef.current) boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight })
    prevCountRef.current = n
  }, [topics])

  // 活跃节点判定：scroll-spy 命中 → 对应节点；流式中 → 虚节点；否则最新话题
  const activeKey = useMemo(() => {
    if (!topics.length) return null
    const li = topics.length - 1
    const last = topics[li]
    if (activeMsgIdx === -1) {
      const pf = last.followups.length - 1
      if (pf >= 0 && last.followups[pf].pending) return `f-${li}-${pf}`
      return last.pending ? `m-${li}` : `f-${li}-${pf}`
    }
    if (activeMsgIdx == null) return `m-${li}`
    for (let i = li; i >= 0; i--) {
      const t = topics[i]
      if (t.msgIdx < 0 || activeMsgIdx < t.msgIdx) continue
      const fi = t.followups.findIndex((f) => f.msgIdx === activeMsgIdx)
      return fi >= 0 ? `f-${i}-${fi}` : `m-${i}`
    }
    return 'm-0'
  }, [topics, activeMsgIdx])

  const totalRows = layout.reduce((a, l) => a + 1 + l.folRows.length, 0)
  const height = Math.max(1, totalRows) * ROW_H + 16

  return (
    <div className="topic-tree" ref={boxRef}>
      {topics.length === 0 ? (
        <p className="topic-empty">话题树将随面试生长…</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ display: 'block' }}>
          {layout.map(({ topic, mainRow, folRows }, ti) => {
            const my = 18 + mainRow * ROW_H
            return (
              <g key={`t${ti}`}>
                {/* 主干：本主问题 → 下一主问题 */}
                {ti + 1 < layout.length && (
                  <line
                    x1={MAIN_X}
                    y1={my + R_MAIN}
                    x2={MAIN_X}
                    y2={18 + layout[ti + 1].mainRow * ROW_H - R_MAIN}
                    className="tt-spine"
                  />
                )}
                {/* 追问分支（向右生长） */}
                {topic.followups.map((f, fi) => {
                  const fy = 18 + folRows[fi] * ROW_H
                  const key = `f-${ti}-${fi}`
                  return (
                    <g key={key}>
                      <path
                        d={`M ${MAIN_X + R_MAIN} ${my} H ${FOLLOW_X - 26} V ${fy} H ${FOLLOW_X - R_FOL - 2}`}
                        className="tt-branch"
                        fill="none"
                      />
                      <g
                        className={`tt-node fol${f.pending ? ' pending' : ''}${activeKey === key ? ' active' : ''}`}
                        onClick={f.msgIdx >= 0 ? () => onSelect(f.msgIdx) : undefined}
                        style={f.msgIdx >= 0 ? { cursor: 'pointer' } : undefined}
                      >
                        {activeKey === key && <circle cx={FOLLOW_X} cy={fy} r={R_FOL + 4} className="tt-halo" />}
                        <circle cx={FOLLOW_X} cy={fy} r={R_FOL} className="tt-dot" />
                        <rect x={FOLLOW_X - 14} y={fy - 13} width={W - FOLLOW_X - 8} height={26} fill="transparent" />
                        <text x={FOLLOW_X + 14} y={fy + 4} className="tt-label fol">
                          {clip(f.qtype ?? '追问', 9)}
                        </text>
                      </g>
                    </g>
                  )
                })}
                {/* 主问题节点 */}
                <g
                  className={`tt-node main${topic.pending ? ' pending' : ''}${activeKey === `m-${ti}` ? ' active' : ''}`}
                  onClick={topic.msgIdx >= 0 ? () => onSelect(topic.msgIdx) : undefined}
                  style={topic.msgIdx >= 0 ? { cursor: 'pointer' } : undefined}
                >
                  {activeKey === `m-${ti}` && <circle cx={MAIN_X} cy={my} r={R_MAIN + 5} className="tt-halo" />}
                  <circle cx={MAIN_X} cy={my} r={R_MAIN} className="tt-dot" />
                  <text x={MAIN_X} y={my + 4} textAnchor="middle" className="tt-seq">
                    {topic.seq}
                  </text>
                  <text x={MAIN_X + 22} y={my + 4} className="tt-label">
                    {clip(topic.qtype ?? '主问题', 10)}
                  </text>
                  <rect x={4} y={my - 16} width={W - 12} height={32} fill="transparent" />
                </g>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}
