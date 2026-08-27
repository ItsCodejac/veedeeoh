import { defineConfig, loadEnv } from "vite";

// WHICH PRODUCT IS THIS BUILD.
//
// Two things are built from this repo. Cloud is Vercel plus Supabase, and it
// sells access rather than content: the catalogue is the same free one either
// way, and the subscription buys sync, profiles, parties and not having to run
// anything. Self-host is the Hono server with its state in a local JSON store,
// and it has to stand alone -- no Supabase, no subscription, none of the
// machinery built for cloud.
//
// So a build with no Supabase credentials is not a misconfigured cloud build.
// It is a self-host build, and it must succeed. This once threw instead, which
// forced self-hosters to own a Supabase project to compile the app at all --
// exactly backwards.
//
// What must never come back is a DEFAULT. The credentials previously fell back
// to veedeeoh.com's own, so a build with no configuration produced a
// working-looking app pointed at our database. Absent now means absent, and
// auth.ts turns that into self-host mode rather than into a guess.
function announceMode(mode: string): void {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const cloud = !!(env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL)
    && !!(env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);
  // Printed because the two builds are visually identical and the difference
  // matters: one has accounts and the other does not.
  console.log(cloud
    ? "  veedeeoh: building CLOUD (Supabase configured)"
    : "  veedeeoh: building SELF-HOST (no Supabase; local storage, no accounts)");
}

export default defineConfig(({ mode }) => {
  announceMode(mode);

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
