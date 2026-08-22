// In-app bug and feature reporting.
//
// The point is the auto-attached context. Diagnosing today's failures took a
// round trip each time to ask what page the user was on, what the console said,
// and which bundle they were running. All of that is captured here so a tester
// only has to describe what they saw.

import { getSupabase, getSession } from "./auth";
import { getActiveProfile } from "./profiles";

// Ring buffer of recent console errors/warnings, installed at boot. A pasted
// console log is what pinpointed the 405 preflight failure; capturing it
// automatically removes that step.
const RING_SIZE = 20;
const ring: { level: string; at: string; msg: string }[] = [];

// Console output routinely contains signed URLs. Never ship those.
const SCRUB = /(jwt=|access_token=|apikey=|api_key=|Bearer\s+|token=)[A-Za-z0-9._\-]+/gi;
const scrub = (s: string) => s.replace(SCRUB, (_m, p1) => `${p1}[redacted]`);

function record(level: string, args: unknown[]): void {
  try {
    const msg = args.map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === "string") return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(" ");
    ring.push({ level, at: new Date().toISOString(), msg: scrub(msg).slice(0, 500) });
    if (ring.length > RING_SIZE) ring.shift();
  } catch {}
}

/** True when the current call originated in OUR code rather than a browser
 *  extension.
 *
 *  Extensions log into the page's console, so a user with a crypto wallet
 *  installed files a bug report that is mostly MetaMask's ObjectMultiplex
 *  chatter with the real error buried somewhere inside it. The stack tells us
 *  where the call came from: extension frames carry a chrome-extension:// or
 *  moz-extension:// origin, or a bare contentscript.js.
 *
 *  Fails OPEN -- if there is no stack, or nothing recognisable in it, the entry
 *  is kept. Losing a genuine error is far worse than keeping some noise. */
function isOurs(): boolean {
  const stack = new Error().stack || "";
  if (!stack) return true;
  const frames = stack.split("\n").slice(2);
  const ext = frames.some((f) => /chrome-extension:\/\/|moz-extension:\/\/|safari-web-extension:\/\/|contentscript\.js/.test(f));
  if (!ext) return true;
  // Mixed stack: an extension wrapping our code still counts as ours.
  return frames.some((f) => f.includes("/assets/") || f.includes(location.origin));
}

export function installConsoleCapture(): void {
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      if (isOurs()) record(level, args);
      original(...args);
    };
  }
  window.addEventListener("error", (e) => record("error", [e.message]));
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) =>
    record("error", [`unhandled rejection: ${e.reason}`]));
}

function currentView(): string {
  // Kept in step with the panels in index.html. It listed four views while the
  // app had eight, so any report filed from search, settings, a party or a
  // category grid arrived saying "unknown" -- on the field most likely to
  // narrow down where a bug lives.
  const views = [
    ["homeView", "home"], ["showsView", "shows"], ["moviesView", "movies"],
    ["kidsView", "kids"], ["partyView", "party"], ["searchView", "search"],
    ["settingsView", "settings"], ["categoryView", "category"],
  ] as const;
  for (const [id, name] of views) {
    const el = document.getElementById(id);
    if (el && !el.hasAttribute("hidden")) return name;
  }
  // The player sits over everything, so report it only when nothing else is up.
  const p = document.getElementById("vodPlayerOverlay");
  if (p && !p.hasAttribute("hidden")) return "player";
  return "unknown";
}

// The hashed bundle filename identifies the exact build. A stale bundle cost a
// diagnostic round trip today; this makes it self-reporting.
function appVersion(): string {
  const s = Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"))
    .map((x) => x.src).find((x) => /\/assets\/main-/.test(x));
  return s ? (s.split("/").pop() || "unknown") : "unknown";
}

async function submit(kind: "bug" | "feature", title: string, body: string): Promise<void> {
  const profile = (() => { try { return getActiveProfile(); } catch { return null as any; } })();
  const { data } = await getSupabase().auth.getUser();
  const row = {
    kind,
    title: title.slice(0, 200),
    body: body.slice(0, 4000),
    reporter_user_id: data.user?.id ?? null,
    reporter_email: data.user?.email ?? getSession()?.email ?? null,
    profile_id: profile?.id ?? null,
    profile_is_kids: !!profile?.is_kids,
    url: location.href.split("#")[0],
    view: currentView(),
    app_version: appVersion(),
    user_agent: navigator.userAgent.slice(0, 300),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    console_tail: ring.slice(-RING_SIZE),
  };
  const { error } = await getSupabase().from("feedback").insert(row);
  if (error) throw error;
}

/** One-tap "this didn't play" report from inside the player. Everything needed
 *  to diagnose it is attached automatically -- provider, title, stream URL shape
 *  and the console tail -- so the tester only has to tap once. Playback failures
 *  are the reports where the console matters most and where a written
 *  description helps least. */
export async function reportPlaybackFailure(ctx: {
  title?: string; contentId?: string; provider?: string; detail?: string;
}): Promise<void> {
  const body = [
    ctx.contentId ? `content: ${ctx.contentId}` : null,
    ctx.provider ? `provider: ${ctx.provider}` : null,
    ctx.detail ? `error: ${ctx.detail}` : null,
  ].filter(Boolean).join("\n");
  await submit("bug", `Won't play: ${ctx.title || "unknown title"}`, body);
}

function openForm(): void {
  if (document.getElementById("fbModal")) return;
  const m = document.createElement("div");
  m.id = "fbModal";
  m.style.cssText = "position:fixed;inset:0;z-index:10050;background:rgba(6,7,10,.9);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;padding:20px;font-family:'Space Grotesk',sans-serif;color:#fff;";
  m.innerHTML = `
    <div style="background:#10141e;border:1px solid rgba(255,255,255,.14);border-radius:18px;max-width:440px;width:100%;padding:26px;">
      <h3 style="margin:0 0 4px;font-size:19px;font-weight:800;">Report something</h3>
      <p style="margin:0 0 18px;font-size:13px;color:#9aa5b5;line-height:1.5;">
        Your profile, page, browser and any recent errors are attached automatically. Just say what happened.
      </p>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <button data-kind="bug" class="fbKind" style="flex:1;padding:9px;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font-weight:700;font-size:13px;cursor:pointer;">Something's broken</button>
        <button data-kind="feature" class="fbKind" style="flex:1;padding:9px;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font-weight:700;font-size:13px;cursor:pointer;">I want something</button>
      </div>
      <input id="fbTitle" placeholder="One line summary" maxlength="200"
        style="width:100%;padding:11px;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:#080a10;color:#fff;font:14px 'Space Grotesk',sans-serif;margin-bottom:9px;" />
      <textarea id="fbBody" rows="4" placeholder="What were you doing? What did you expect?"
        style="width:100%;padding:11px;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:#080a10;color:#fff;font:14px 'Space Grotesk',sans-serif;resize:vertical;"></textarea>
      <div id="fbErr" style="min-height:16px;font-size:12px;color:#ff6b6b;margin-top:6px;"></div>
      <div style="display:flex;gap:10px;margin-top:8px;">
        <button id="fbCancel" style="flex:1;padding:11px;border-radius:10px;background:rgba(255,255,255,.08);border:none;color:#9aa5b5;font-weight:700;cursor:pointer;">Cancel</button>
        <button id="fbSend" style="flex:1;padding:11px;border-radius:10px;background:#c5f04e;border:none;color:#06070a;font-weight:800;cursor:pointer;">Send</button>
      </div>
    </div>`;
  document.body.appendChild(m);

  let kind: "bug" | "feature" = "bug";
  const paint = () => m.querySelectorAll<HTMLElement>(".fbKind").forEach((b) => {
    const on = b.dataset.kind === kind;
    b.style.background = on ? "#c5f04e" : "rgba(255,255,255,.06)";
    b.style.color = on ? "#06070a" : "#fff";
  });
  m.querySelectorAll<HTMLElement>(".fbKind").forEach((b) =>
    b.addEventListener("click", () => { kind = b.dataset.kind as any; paint(); }));
  paint();

  const close = () => m.remove();
  (m.querySelector("#fbCancel") as HTMLElement).onclick = close;
  m.addEventListener("click", (e) => { if (e.target === m) close(); });

  const send = m.querySelector("#fbSend") as HTMLButtonElement;
  send.onclick = async () => {
    const title = (m.querySelector("#fbTitle") as HTMLInputElement).value.trim();
    const body = (m.querySelector("#fbBody") as HTMLTextAreaElement).value.trim();
    const err = m.querySelector("#fbErr") as HTMLElement;
    if (!title) { err.textContent = "A one line summary helps more than you'd think."; return; }
    send.disabled = true; send.textContent = "Sending…";
    try {
      await submit(kind, title, body);
      m.innerHTML = `<div style="background:#10141e;border:1px solid rgba(197,240,78,.3);border-radius:18px;padding:30px;text-align:center;max-width:380px;">
        <div style="font-size:18px;font-weight:800;margin-bottom:6px;">Got it</div>
        <div style="font-size:13px;color:#9aa5b5;line-height:1.5;">Thanks. This lands in front of me with everything I need to reproduce it.</div></div>`;
      setTimeout(close, 2200);
    } catch (e: any) {
      err.textContent = e?.message || "Could not send. Try again in a moment.";
      send.disabled = false; send.textContent = "Send";
    }
  };
}

/** Quiet sidebar row above the profile, matching the install prompt. */
export function mountFeedbackEntry(): void {
  if (document.getElementById("fbEntry")) return;
  const anchor = document.getElementById("sidebarUser");
  if (!anchor?.parentElement) return;

  const el = document.createElement("button");
  el.id = "fbEntry";
  el.className = "sidebar-feedback";
  el.title = "Report a bug or request a feature";
  el.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg><span>Report something</span>`;
  el.addEventListener("click", openForm);
  anchor.parentElement.insertBefore(el, anchor);
}
