import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// 开发期用代理转发 /api 到本地 Java 后端，规避 CORS；
// 生产由 Electron 加载打包产物，无跨域问题（04 §5、10 §8）。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:17860',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
