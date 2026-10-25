/** 工作包 C：动效系统统一出口（framer-motion）。
 *
 *  全站动效语言：180ms 级快出快入、位移 ≤12px、只做 opacity/transform（无 blur/filter 动画）；
 *  所有动效经 useReducedMotion() 尊重 prefers-reduced-motion——reduced 时禁用位移/缩放动画，
 *  保留状态变化本身（直接渲染终态）。
 */
import { forwardRef, type ReactNode } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion, type Variants } from 'framer-motion'

export { AnimatePresence, LayoutGroup, motion, useReducedMotion }

export const EASE: [number, number, number, number] = [0.25, 0.6, 0.25, 1]
export const DUR = 0.18

/** 路由页转场：入场 淡入+轻微上浮；退场仅淡出（140ms，防白屏闪烁）。 */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR, ease: EASE } },
  exit: { opacity: 0, transition: { duration: 0.14 } },
}

/** 路由页包装（forwardRef：AnimatePresence popLayout 需要测量子节点）。 */
export const PageTransition = forwardRef<HTMLDivElement, { children: ReactNode }>(
  function PageTransition(props, ref) {
    const reduced = useReducedMotion()
    if (reduced) return <div ref={ref}>{props.children}</div>
    return (
      <motion.div ref={ref} variants={pageVariants} initial="initial" animate="animate" exit="exit">
        {props.children}
      </motion.div>
    )
  },
)

/** 列表 stagger：容器逐条唤起子项（报告逐题/清单用）。 */
export const staggerContainer: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.055, delayChildren: 0.06 } },
}

/** 子项：上浮入场（逐题卡片）。 */
export const riseItem: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE } },
}

/** 子项：弹入（薄弱项/亮点标签，spring 轻回弹）。 */
export const popItem: Variants = {
  initial: { opacity: 0, scale: 0.88 },
  animate: { opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 420, damping: 24 } },
}

/** 气泡逐条入场（面试官消息随 TTS 分句浮现；仅淡入+微位移）。 */
export const bubbleIn: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.18, ease: EASE } },
}
