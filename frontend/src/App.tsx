/** D1 应用壳：顶栏（品牌/导航/主题开关）+ 路由表。
 *  活动会话（SSE/TTS/作答状态）由 <SessionRuntime /> 常驻托管，路由只控显隐。
 *  C1：路由页入场转场（fade+slide）。
 *  v2.6-2 修复：路由级 AnimatePresence(wait) 包 Routes 在实际运行中 exit 不触发，
 *  导致 SPA 切页冻结在首屏路由（顶栏/编程导航全部失灵）——去掉等待式转场，
 *  退场改瞬时（PageTransition 仅保留入场动画），路由可靠性优先。
 */
import { useEffect } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router'
import BankPage from './pages/BankPage'
import CampaignPage from './pages/CampaignPage'
import InterviewHomePage from './pages/InterviewHomePage'
import ResumePage from './pages/ResumePage'
import { LayoutGroup, PageTransition } from './motion'
import { SessionRuntime } from './session'
import { themeButtonLabel, useTheme } from './theme'

const TABS = [
  { to: '/', label: '面试', end: true },
  { to: '/bank', label: '题库' },
  { to: '/resume', label: '简历' },
]

export default function App() {
  const { mode, toggle } = useTheme()
  const location = useLocation()
  const { pathname } = location
  // 会话/战役视图归属「面试」导航高亮
  const interviewActive = pathname === '/' || pathname.startsWith('/session') || pathname.startsWith('/campaign')

  // C1：路由切换回到顶部（会话页内部滚动由会话视图自理，页面级滚动条始终复位）
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">AI 面试官</div>
        <nav className="tabs">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={
                'tab' +
                (t.to === '/'
                  ? interviewActive
                    ? ' active'
                    : ''
                  : pathname.startsWith(t.to)
                    ? ' active'
                    : '')
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <button
          className="btn small theme-btn"
          title="切换浅色 / 深色"
          onClick={toggle}
        >
          {themeButtonLabel(mode)}
        </button>
      </header>
      <main className="content">
        {/* v2.6-2：瞬时切页 + 入场动画（见文件头注释）；SessionRuntime 常驻渲染 /session/:id */}
        <LayoutGroup>
          <Routes location={location}>
            <Route path="/" element={<PageTransition><InterviewHomePage /></PageTransition>} />
            <Route path="/session/:id" element={null} />
            <Route path="/campaign/:id" element={<PageTransition><CampaignPage /></PageTransition>} />
            <Route path="/bank" element={<PageTransition><BankPage /></PageTransition>} />
            <Route path="/resume" element={<PageTransition><ResumePage /></PageTransition>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <SessionRuntime />
        </LayoutGroup>
      </main>
    </div>
  )
}
