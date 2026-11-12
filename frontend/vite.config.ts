import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// 用 import.meta.dirname 而非 __dirname：Vite 计划把 configLoader 默认切到 native，
// native loader 不注入 __dirname 这层 shim（Node 20.11+ 原生支持 import.meta.dirname）
const rootDir = import.meta.dirname

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      '@homibook/core': path.resolve(rootDir, '../packages/core/src/index.ts'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/docs': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
})