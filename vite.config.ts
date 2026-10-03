import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // На GitHub Pages сайт живёт по пути /<имя-репозитория>/, а не в корне домена.
  // Локально (vite dev/preview) base остаётся '/'.
  base: process.env.GITHUB_ACTIONS ? '/my_first_page/' : '/',
})
