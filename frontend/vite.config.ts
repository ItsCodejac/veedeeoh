import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "../src/tvlc/static",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        landing: 'landing.html',
        changePassword: 'change-password.html'
      }
    }
  },
  server: {
    proxy: {
      // vite dev server on :5173 talks to the running tvlc backend
      "/api": "http://127.0.0.1:8321",
      "/proxy": "http://127.0.0.1:8321",
      "/logo": "http://127.0.0.1:8321",
      "/playlist.m3u": "http://127.0.0.1:8321",
    },
  },
});
