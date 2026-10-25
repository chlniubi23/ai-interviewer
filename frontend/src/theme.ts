/** 深浅色主题（v2.3.1-1 两态化）。
 *
 * 仅 浅色/深色 两态（v2.3.1 按用户反馈移除「跟随系统」），点一下切到另一态并记忆
 * localStorage（默认浅色；读到旧版 'auto' 值回落浅色）。生效值写 <html data-theme>，
 * index.html 里有首屏预置脚本防闪白。
 */
import { useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark'

const KEY = 'ai_interviewer_theme'

function readMode(): ThemeMode {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readMode)

  useEffect(() => {
    document.documentElement.dataset.theme = mode
    try {
      localStorage.setItem(KEY, mode)
    } catch {
      /* 忽略隐私模式写入失败 */
    }
  }, [mode])

  /** 单一切换开关：点一下切到另一态。 */
  function toggle() {
    setMode((m) => (m === 'light' ? 'dark' : 'light'))
  }

  return { mode, toggle }
}

/** 按钮文案显示目标态（当前浅色则提示可切到深色）。 */
export function themeButtonLabel(mode: ThemeMode): string {
  return mode === 'light' ? '🌙 深色' : '☀️ 浅色'
}
