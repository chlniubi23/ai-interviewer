/** 自适应多行输入框（v2.3.1-2）。
 *
 * - 自动增高：高度随内容实时增长（先 auto 再钳回 scrollHeight），minRows~maxRows 之间
 *   无内滚动条，超过 maxRows 出滚动；min/max 高度按行高（1.7em/行）+ 内边距余量换算。
 * - 行宽控制：maxWidthChars 按中文字数（1 全角 ≈ 1em）限制 max-width，宽度不再撑满容器；
 *   容器更窄时自然回退（width 与 max-width 取小者）。0/缺省 = 不限制。
 * 视觉沿用 .ta（主题边框/焦点），resize 关闭；全局 border-box 下 height 需补边框像素。
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { CSSProperties } from 'react'

const LINE_EM = 1.7 // 每行行高（em 倍数，与 .ta 字号联动）
const CHROME_PX = 18 // padding(7×2)+border(1×2) 的 border-box 余量

export default function AutoTextarea(props: {
  value: string
  onChange: (v: string) => void
  minRows?: number
  maxRows?: number
  /** 每行约多少个中文字符后折行；0/缺省不限制 */
  maxWidthChars?: number
  placeholder?: string
  disabled?: boolean
}) {
  const { value, onChange, minRows = 4, maxRows = 12, maxWidthChars = 0, placeholder, disabled } = props
  const ref = useRef<HTMLTextAreaElement>(null)

  const resize = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    // +2px 补 border-box 下的边框像素，避免差 1px 常显滚动条
    el.style.height = `${el.scrollHeight + 2}px`
  }

  useLayoutEffect(resize, [])
  useEffect(resize, [value])
  // 窗口缩放/主题切换导致的折行变化重算一次
  useEffect(() => {
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const style: CSSProperties = {
    lineHeight: `${LINE_EM}`,
    minHeight: `calc(${minRows * LINE_EM}em + ${CHROME_PX}px)`,
    maxHeight: `calc(${maxRows * LINE_EM}em + ${CHROME_PX}px)`,
    overflowY: 'auto',
  }
  if (maxWidthChars) style.maxWidth = `calc(${maxWidthChars}em + 24px)`

  return (
    <textarea
      ref={ref}
      className="ta auto-ta"
      style={style}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
