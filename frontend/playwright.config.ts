import { defineConfig } from '@playwright/test'

/**
 * v2.6-2 最小冒烟：应用启动 → 三页路由渲染 → 主题切换 → 新建表单校验（全程不调 LLM）。
 * 默认复用已启动的本地服务（后端 9000 / 前端 5173）；没有服务时自动拉起。
 * 注意：冒烟连接的是真实后端（不建会话、不评报告，零 LLM 调用）。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    channel: 'chromium', // 用完整 chromium 的新 headless（无需另装 headless-shell）
  },
  webServer: [
    {
      // Windows cmd 解析不了以 ../ 开头的可执行路径（'..' 会被当成命令名），必须用反斜杠
      command: '..\\backend\\.venv\\Scripts\\python.exe -m uvicorn main:app --app-dir ..\\backend --port 9000',
      url: 'http://127.0.0.1:9000/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npx vite --port 5173 --strictPort',
      url: 'http://127.0.0.1:5173/',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
