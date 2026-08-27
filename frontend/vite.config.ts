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
// WHY THIS REFUSES TO GUESS ON A HOSTED DEPLOY.
//
// Because credentials alone decide the product, a cloud deploy that lost its
// environment would not fail. It would quietly compile the self-host build and
// ship it to veedeeoh.com: no sign-in, no accounts, no parties, for everybody,
// and a green deploy log. The blast radius is the entire paying userbase and the
// only symptom is that the app looks fine and knows nobody.
//
// So intent is stated rather than inferred whenever it can be known:
//
//   VEEDEEOH_TARGET=cloud     credentials are mandatory, absent is a hard error
//   VEEDEEOH_TARGET=selfhost  credentials are ignored
//   unset, on Vercel          treated as cloud, because ours is the only thing
//                             that deploys there and Vercel sets VERCEL itself,
//                             so it cannot be forgotten the way a var we add can
//   unset, anywhere else      whatever the credentials say, self-host by default
//
// A self-hoster who genuinely wants Vercel sets VEEDEEOH_TARGET=selfhost, which
// the error below tells them.
function resolveTarget(mode: string): "cloud" | "selfhost" {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const has = (k: string) => !!(env[k] || process.env[k]);
  const cloudConfigured = has("VITE_SUPABASE_URL") && has("VITE_SUPABASE_ANON_KEY");

  const declared = (process.env.VEEDEEOH_TARGET || "").toLowerCase();
  if (declared && declared !== "cloud" && declared !== "selfhost") {
    throw new Error(`\n\n  VEEDEEOH_TARGET must be "cloud" or "selfhost", got "${declared}".\n`);
  }

  const target: "cloud" | "selfhost" =
    declared === "cloud" ? "cloud"
    : declared === "selfhost" ? "selfhost"
    : process.env.VERCEL ? "cloud"
    : cloudConfigured ? "cloud" : "selfhost";

  if (target === "cloud" && !cloudConfigured) {
    throw new Error(
      "\n\n  Refusing to build: this is a CLOUD build with no Supabase credentials.\n\n" +
      "  Building anyway would produce the self-host app and ship it as the hosted\n" +
      "  service: no sign-in and no accounts for anyone, with a passing build.\n\n" +
      "  Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.\n" +
      "  If you meant to build the standalone app, set VEEDEEOH_TARGET=selfhost.\n",
    );
  }

  // Printed because the two builds are visually identical and the difference is
  // whether the app has accounts at all.
  console.log(target === "cloud"
    ? "  veedeeoh: building CLOUD (Supabase configured)"
    : "  veedeeoh: building SELF-HOST (no Supabase; local storage, no accounts)");
  return target;
}

export default defineConfig(({ mode }) => {
  resolveTarget(mode);

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
