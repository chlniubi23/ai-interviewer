import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // 监听 0.0.0.0，手机经同一 WiFi 用局域网 IP 访问
    proxy: {
      // 8123：8000 曾被 Windows 保留端口段（Hyper-V WinNAT，7966-8065）圈占导致绑定被拒（WSAEACCES）
      '/api': 'http://127.0.0.1:9000',
    },
  },
})
