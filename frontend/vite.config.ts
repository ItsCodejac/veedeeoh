import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "../src/tvlc/static",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: 'index.html',
        landing: 'landing.html',
        changePassword: 'change-password.html',
        privacy: 'privacy.html',
        terms: 'terms.html',
        notFound: '404.html',
        selfHosting: 'self-hosting.html'
      }
    }
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8321",
      "/proxy": "http://127.0.0.1:8321",
      "/logo": "http://127.0.0.1:8321",
      "/playlist.m3u": "http://127.0.0.1:8321",
    },
  },
});
