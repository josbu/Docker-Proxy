import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 开发时 Vite 跑在 5173，把 /api 反向代理到 Express 后端 (3000)。
// 生产构建输出到 ../web/dist，覆盖此前废弃的 React 构建，由 Express 静态托管。
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: '../web/dist',
    // 每次构建前清空输出目录，避免旧的 hash chunk 在 Docker 镜像里残留膨胀。
    // publicDir 中的静态资源（src/public/images）仍会被自动复制回 web/dist/images。
    emptyOutDir: true
  }
})
