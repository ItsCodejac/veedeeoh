import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "../src/tvlc/static",
    // Clean the output each build so stale hashed chunks don't pile up. Every
    // persistent file (favicons, bump videos, posters, manifest) lives in
    // frontend/public and is re-copied, so nothing is lost.
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        landing: 'landing.html',
        changePassword: 'change-password.html',
        privacy: 'privacy.html',
        terms: 'terms.html',
        notFound: '404.html',
        selfHosting: 'self-hosting.html',
        authConfirm: 'auth-confirm.html'
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
