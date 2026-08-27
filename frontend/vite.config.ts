import { defineConfig, loadEnv } from "vite";

// Refuse to build a frontend that does not know which database it talks to.
//
// This is here because the alternative was worse than a broken build. The
// Supabase URL and anon key used to fall back to the veedeeoh.com project's
// own, so a clone with no env files -- which is every clone, since they are
// gitignored -- produced a working-looking app that signed its users into our
// database, against our quota. Nothing surfaced it at build time, at run time,
// or anywhere in the UI.
//
// A build that stops with the name of the missing variable is a five-second
// fix. A build that silently points somewhere else is found much later, by
// someone else's accounts appearing in your auth table.
function requireEnv(mode: string): void {
  const root = process.cwd();
  const env = loadEnv(mode, root, "VITE_");
  const missing = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]
    .filter((k) => !(env[k] || process.env[k]));
  if (!missing.length) return;

  throw new Error(
    `\n\n  Cannot build: ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set.\n\n` +
    "  veedeeoh needs its own Supabase project to run. Create one, apply\n" +
    "  supabase/migrations to it, then copy frontend/.env.example to\n" +
    "  frontend/.env and fill in the project URL and anon key.\n\n" +
    "  Full walkthrough: frontend/self-hosting.html\n",
  );
}

export default defineConfig(({ mode }) => {
  requireEnv(mode);

  return {
    build: {
      outDir: "../src/tvlc/static",
      // Clean the output each build so stale hashed chunks don't pile up. Every
      // persistent file (favicons, bump videos, posters, manifest) lives in
      // frontend/public and is re-copied, so nothing is lost.
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: "index.html",
          landing: "landing.html",
          changePassword: "change-password.html",
          privacy: "privacy.html",
          terms: "terms.html",
          notFound: "404.html",
          selfHosting: "self-hosting.html",
          authConfirm: "auth-confirm.html",
        },
      },
    },
    server: {
      proxy: {
        "/api": "http://127.0.0.1:8321",
        "/proxy": "http://127.0.0.1:8321",
        "/logo": "http://127.0.0.1:8321",
        "/playlist.m3u": "http://127.0.0.1:8321",
      },
    },
  };
});
