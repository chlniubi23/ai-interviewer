import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { SessionProvider } from './session.tsx'

// D2：列表/详情缓存（SSE 流式不走 Query，仍用原生 fetch）
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000, // 同数据二次进入直接命中缓存，无闪烁；过期后后台静默刷新
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
