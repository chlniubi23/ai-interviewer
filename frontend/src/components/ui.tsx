/** 基础 UI 件统一出口（D3 规范化）：Button / Card / Chip / EmptyState / Skeleton / CountUp。
 *  新组件一律从这里取，不再手写 className 拼接。
 *  C4：EmptyState 弹入入场（reduced-motion 下静态）。
 */
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { EASE, motion, useReducedMotion } from '../motion'

/** 按钮：variant 语义（primary 主操作 / danger 危险）+ small 尺寸。 */
export function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'default' | 'primary' | 'danger'
    size?: 'default' | 'small'
  },
) {
  const { variant = 'default', size = 'default', className, ...rest } = props
  const cls =
    'btn' +
    (size === 'small' ? ' small' : '') +
    (variant === 'primary' ? ' primary' : variant === 'danger' ? ' danger' : '') +
    (className ? ` ${className}` : '')
  return <button className={cls} {...rest} />
}

/** 卡片容器（对应 .card）。 */
export function Card(props: { className?: string; children: ReactNode }) {
  return <section className={'card' + (props.className ? ` ${props.className}` : '')}>{props.children}</section>
}

/** 状态徽标：go 好 / hold 中 / drop 差 / none 中性（对应 .chip.*）。 */
export function Chip(props: { tone?: 'go' | 'hold' | 'drop' | 'none'; title?: string; children: ReactNode }) {
  return (
    <span className={`chip ${props.tone ?? 'none'}`} title={props.title}>
      {props.children}
    </span>
  )
}

/** 数字滚动：value 变化时从当前值缓动到目标值（报告/统计卡片用）。 */
export function CountUp(props: { value: number | null; decimals?: number; duration?: number }) {
  const { value, decimals = 0, duration = 700 } = props
  const [n, setN] = useState(0)
  useEffect(() => {
    if (value == null || !Number.isFinite(value)) return
    const target = value
    const from = n
    const t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setN(from + (target - from) * eased)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  if (value == null || !Number.isFinite(value)) return <>—</>
  return <>{n.toFixed(decimals)}</>
}

/** 骨架屏块：加载中占位（lines 条数，最后一行短）。 */
export function Skeleton(props: { lines?: number }) {
  const lines = props.lines ?? 3
  return (
    <div className="skeleton-box" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="skeleton-line"
          style={{ width: i === lines - 1 ? '58%' : `${88 - i * 7}%` }}
        />
      ))}
    </div>
  )
}

/** 空状态插画位：icon（emoji 大字号）+ 标题 + 提示 + 可选动作（C4：弹入入场）。 */
export function EmptyState(props: { icon: string; title: string; hint?: string; children?: ReactNode }) {
  const reduced = useReducedMotion()
  const inner = (
    <>
      <div className="empty-icon">{props.icon}</div>
      <div className="empty-title">{props.title}</div>
      {props.hint && <p className="muted">{props.hint}</p>}
      {props.children}
    </>
  )
  if (reduced) return <div className="empty-state">{inner}</div>
  return (
    <motion.div
      className="empty-state"
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      {inner}
    </motion.div>
  )
}
