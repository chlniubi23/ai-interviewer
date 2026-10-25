/** 断点侦听：matchMedia 响应式 hook（驾驶舱侧栏折叠/抽屉用）。 */
import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [hit, setHit] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const fn = () => setHit(m.matches)
    fn()
    m.addEventListener('change', fn)
    return () => m.removeEventListener('change', fn)
  }, [query])
  return hit
}
