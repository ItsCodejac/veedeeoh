// veedeeoh.party -- the directory.
//
// Ported from the design handoff's party-app.html. The markup below is the
// design's own, with the mock data replaced by real calls and the design's mock
// host chrome dropped. Styling lives in party-app.css, scoped to #partyApp.
//
// THE ONE RULE THAT KEEPS BEING REDISCOVERED: nothing here filters in the
// browser. public_parties() takes every filter as an argument, because
// filtering client-side means shipping the whole directory to every viewer --
// fine at twelve rows and wrong at twelve hundred.

import { escapeHtml, showToast } from "./util";
import {
  activePartyCode, disconnect, joinParty, partyEnabled, partyLink, recentParty, forgetParty,
  resumeHosting, socialUrl, listPublicParties, publicPartyFacets, myPrivateParties,
  comingUp, setReminder, myBlocks, answerAppeal, unblockUser, setPartyNote,
  followHost, publicProfile, mySuggestions, myPicks, saveProfileExtras,
  type PartyFilters, type PublicParty, type PrivateParty, type ComingUp,
  type BlockedPerson, type PublicProfile,
} from "./party";
import { partyCreditSummary } from "./db";
import { getSupabase } from "./auth";
import "./party-app.css";

// ---------------------------------------------------------------------------
// Small shared pieces, ported as-is
// ---------------------------------------------------------------------------

const avc = ["#c5f04e", "#00e0b0", "#ffc107", "#4dabf7", "#ff9f1c", "#a9e34b", "#ff6b6b", "#7ed957"];

/** A colour per person, derived from their name. Other accounts have no avatar
 *  we are allowed to read, so the design uses an initial on a stable colour --
 *  which is also the only thing that cannot leak anything about them. */
const av = (n: string) => avc[(n || "?").charCodeAt(0) % avc.length]!;
const initial = (n: string) => (n || "?").charAt(0).toUpperCase();

const minsSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
const ago = (m: number) =>
  m < 1 ? "just started" : m < 60 ? `${m}m in` : `${Math.floor(m / 60)}h ${m % 60}m in`;

const esc = escapeHtml;

/** A base64 image data URI and nothing else. Deliberately strict: it is the
 *  client half of the same constraint the parties.frame column carries. */
const FRAME_URI = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type Tab = "open" | "private" | "following" | "host";

let mounted: HTMLElement | null = null;
let root: HTMLElement | null = null;
let viewers = 0;
let tab: Tab = "open";
let lastTab: Tab = "open";
let onProfile = false;

const F: PartyFilters & { q: string } = {
  q: "", genre: "", rating: "", decade: "", language: "", size: "",
  freeSeats: false, justStarted: false, followsOnly: false, hasSocial: false,
  sort: "new",
};

let open: PublicParty[] = [];
let totalOpen = 0;
let privateRooms: PrivateParty[] = [];
let upcoming: ComingUp[] = [];
let blocked: BlockedPerson[] = [];
let me: PublicProfile | null = null;
/** The live roster, but only while this client is the one hosting. */
let roster: { watching: Array<{ userId: string; name: string }>; waiting: Array<{ userId: string; name: string }> } =
  { watching: [], waiting: [] };

const hosting = () => !!activePartyCode() && recentParty()?.role === "host";

window.addEventListener("veedeeoh:party-presence", (e) => {
  viewers = (e as CustomEvent).detail?.viewers ?? 0;
  if (root) paintChrome();
});

window.addEventListener("veedeeoh:party-roster", (e) => {
  const d = (e as CustomEvent).detail || {};
  roster = { watching: d.watching || [], waiting: d.waiting || [] };
  if (root) paintPeople();
});

// ---------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------

export function renderParty(el: HTMLElement): void {
  mounted = el;
  el.innerHTML = shell();
  root = el.querySelector<HTMLElement>("#partyApp")!;
  wire();
  paintChrome();
  void loadOpen();
  void loadFacets();
  void loadSide();
}

function shell(): string {
  return `
<div id="partyApp">

  <header class="pBar">
    <div class="pMark">veedeeoh<i>.</i><i style="color:#e82a7e">party</i></div>
    <div class="pLive" id="liveCount"><span class="dot"></span><span>Loading</span></div>
    <div class="grow"></div>
    <div class="codeEntry">
      <input id="barCode" maxlength="6" placeholder="ABC234" aria-label="Party code" spellcheck="false" autocomplete="off">
      <button class="btn" id="barJoin">Join</button>
    </div>
    <button class="btn primary icon" id="startBtn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span id="startLabel">Start a party</span>
    </button>
  </header>

  <div class="strip" id="strip" hidden>
    <div class="badge">Hosting</div>
    <div class="what"><b id="stripTitle"></b><small id="stripSub"></small></div>
    <div class="code" id="stripCode"></div>
    <div class="grow"></div>
    <div class="acts">
      <button class="btn primary" id="stripBack">Back to the party</button>
      <button class="btn" id="stripCopy">Copy invite link</button>
      <button class="btn danger" id="stripEnd">End party</button>
    </div>
  </div>

  <nav class="tabs" role="tablist">
    <button class="tab" role="tab" aria-selected="true"  data-tab="open">Open parties <span class="n" id="nOpen">0</span></button>
    <button class="tab" role="tab" aria-selected="false" data-tab="private">Private <span class="n" id="nPriv">0</span></button>
    <button class="tab" role="tab" aria-selected="false" data-tab="following">Hosts you follow <span class="n" id="nFollow">0</span></button>
    <button class="tab" role="tab" aria-selected="false" data-tab="host">Host <span class="n" id="nHost">0</span></button>
  </nav>

  <div class="filterBar" id="filterBar">
    <div class="fRow">
      <div class="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="q" type="search" placeholder="Search titles, hosts and descriptions" aria-label="Search parties">
        <button class="clr" id="qClr" hidden aria-label="Clear search">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="sortWrap">
        <span>Sort</span>
        <div class="sel"><select id="sort" aria-label="Sort parties">
          <option value="new">Just started</option>
          <option value="most">Most watching</option>
          <option value="ending">Ending soonest</option>
        </select></div>
      </div>
    </div>
    <div class="fRow">
      <div class="fGroup">
        <div class="sel"><select id="fGenre"    aria-label="Genre"><option value="">Genre</option></select></div>
        <div class="sel"><select id="fRating"   aria-label="Rating"><option value="">Rating</option></select></div>
        <div class="sel"><select id="fDecade"   aria-label="Decade"><option value="">Decade</option></select></div>
        <div class="sel"><select id="fLang"     aria-label="Language"><option value="">Language</option></select></div>
        <div class="sel"><select id="fSize" aria-label="Party size">
          <option value="">Party size</option>
          <option value="s">Under 5 watching</option>
          <option value="m">5 to 15 watching</option>
          <option value="l">Over 15 watching</option>
        </select></div>
      </div>
      <div class="fGroup">
        <button class="tgl" id="tSeats"  aria-pressed="false"><span class="tick">&#10003;</span>Free seats</button>
        <button class="tgl" id="tNew"    aria-pressed="false"><span class="tick">&#10003;</span>Just started</button>
        <button class="tgl" id="tFollow" aria-pressed="false"><span class="tick">&#10003;</span>Hosts I follow</button>
        <button class="tgl" id="tSocial" aria-pressed="false"><span class="tick">&#10003;</span>Has a channel</button>
      </div>
    </div>
    <div class="fMeta">
      <span class="fCount" id="fCount"></span>
      <button class="fClear" id="fClear" hidden>Clear filters</button>
    </div>
  </div>

  <div class="pBody">

    <section data-panel="open">
      <div class="explain">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00e0b0" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/><polyline points="12 5 19 12 12 19"/></svg>
        <p><b>Open parties</b> are listed here for anyone to walk into. No approval, no waiting. The host still controls playback and can remove anyone. Watching with just your own people instead? That is a <b>private</b> party.</p>
      </div>
      <div class="grid" id="openGrid"></div>
      <div id="openNone"></div>
    </section>

    <section data-panel="private" hidden>
      <div class="explain">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c5f04e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <p><b>Private parties are not listed anywhere.</b> They do not appear in Open parties, they are not searchable, and nobody can find one by browsing. The six-character code is the only way in, so it is the only thing you need to share.</p>
      </div>

      <div class="joinBig">
        <div class="jbText">
          <h3>Got a code?</h3>
          <p>Six characters, from whoever invited you. Not case sensitive.</p>
        </div>
        <div class="jbForm">
          <input id="bigCode" maxlength="6" placeholder="ABC234" aria-label="Party code" spellcheck="false" autocomplete="off">
          <button class="btn primary" id="bigJoin">Join</button>
        </div>
      </div>

      <div class="sectionHead" style="margin-top:28px">
        <h2>Rooms you can get back into</h2>
        <p>Private rooms you hosted or were let into, from the last thirty days.</p>
      </div>
      <div class="rows" id="privRows"></div>

      <div class="sectionHead" style="margin-top:28px">
        <h2>Starting one for friends</h2>
        <p>Two ways to run a private room, depending on how much control you want at the door.</p>
      </div>
      <div class="kinds">
        <div class="kind">
          <div class="kHead">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c5f04e" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <b>Anyone with the link</b>
          </div>
          <p>No approval step. Whoever has the code walks in. Best for a group chat where everyone is already known.</p>
        </div>
        <div class="kind">
          <div class="kHead">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c5f04e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            <b>Ask me first</b>
          </div>
          <p>Each person knocks and waits until you let them in. They see nothing before that, and people waiting do not use a seat.</p>
        </div>
      </div>
    </section>

    <section data-panel="open-empty" hidden>
      <div class="empty">
        <div class="glyph">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#c5f04e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <h3>Nothing open at the moment</h3>
        <p>This is as good a time as any to be the one running it. Pick something to watch, tick <strong style="color:var(--text)">List this publicly</strong>, and it shows up here for everyone.</p>
        <div class="acts">
          <button class="btn primary" data-start>Start a party</button>
          <button class="btn" data-browse>Browse the catalogue</button>
        </div>
      </div>
    </section>

    <section data-panel="following" hidden>
      <div class="sectionHead">
        <h2>Live from hosts you follow</h2>
        <p>Pinned above everything else.</p>
      </div>
      <div class="grid" id="followGrid" style="margin-bottom:34px"></div>
      <div class="sectionHead">
        <h2>Coming up</h2>
        <p>Built from each host's usual slot, converted to your time.</p>
      </div>
      <div class="rows" id="comingUp"></div>
    </section>

    <section data-panel="host" hidden>
      <div class="stats" id="hostStats"></div>

      <div class="cols">
        <div>
          <div class="block">
            <div class="blockHead"><h3>Requests</h3><span class="n" id="nReq">0</span></div>
            <div class="blockNote">What your followers have asked you to host, most-wanted first. Who suggested what stays private.</div>
            <div id="requests"></div>
          </div>

          <div class="block">
            <div class="blockHead"><h3>People</h3><span class="grow"></span><span class="tag" id="roomState">No party running</span></div>
            <div class="segs" role="tablist">
              <button class="seg" role="tab" aria-selected="true"  data-seg="room">In the room <span class="b" id="nRoom">0</span></button>
              <button class="seg" role="tab" aria-selected="false" data-seg="knocking">Knocking <span class="b" id="nKnock">0</span></button>
              <button class="seg" role="tab" aria-selected="false" data-seg="blocked">Blocked <span class="b" id="nBlocked">0</span></button>
              <button class="seg" role="tab" aria-selected="false" data-seg="appeals">Asking to return <span class="b" id="nAppeals">0</span></button>
            </div>
            <div data-seg-panel="room"><div id="inRoom"></div></div>
            <div data-seg-panel="knocking" id="knockPanel" hidden></div>
            <div data-seg-panel="blocked" hidden><div id="blocked"></div></div>
            <div data-seg-panel="appeals" hidden>
              <div class="blockNote">Someone you blocked can send one short message asking to come back. It reaches only you, it is never shown in a party, and they cannot send another until you answer.</div>
              <div id="appeals"></div>
            </div>
          </div>

          <div class="block">
            <div class="blockHead"><h3>Your parties</h3></div>
            <div id="yoursRows"></div>
          </div>
        </div>

        <div>
          <div class="block">
            <div class="blockHead"><h3>Your slot</h3></div>
            <div class="blockBody"><div class="sched" id="sched"></div></div>
          </div>

          <div class="block">
            <div class="blockHead"><h3>Watch party hours</h3><span class="grow"></span><button class="btn sm" id="buyHours">Buy more</button></div>
            <div class="blockBody"><div class="ledger" id="ledger"></div></div>
          </div>

          <div class="block">
            <div class="blockHead"><h3>Recommendations</h3></div>
            <div class="blockNote">Shown on your public profile whether or not you are live.</div>
            <div class="blockBody"><div class="shelf" id="shelf"></div></div>
          </div>

          <div class="block">
            <div class="blockHead"><h3>Your public profile</h3></div>
            <div class="blockBody" id="myProfile"></div>
          </div>
        </div>
      </div>
    </section>

    <section data-panel="profile" hidden>
      <button class="backBtn" id="profBack">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        <span id="profBackLabel">Back</span>
      </button>
      <div id="profBody"></div>
    </section>

  </div>
  ${partyEnabled() ? "" : `<div class="warn" style="margin:20px 28px">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffc107" stroke-width="2" stroke-linecap="round"><path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg>
    <p><b>Watch Party is not configured on this deployment.</b> The directory still lists what is running, but nothing here can start or join a party until the relay address is set.</p>
  </div>`}
</div>`;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T | null =>
  root ? root.querySelector<T>(sel) : null;

// ---------------------------------------------------------------------------
// Cards and rows, ported from the design
// ---------------------------------------------------------------------------

function card(p: PublicParty, i: number): string {
  const full = p.seat_limit != null && p.joined_count >= p.seat_limit;
  const host = p.host_handle || p.host_name || "someone";
  const mins = minsSince(p.started_at);
  // The empty well is the default and stays the default. A frame replaces it
  // only when one exists, which is never for a private room and not at all for
  // a provider whose media cannot be read off the canvas.
  //
  // AN <img>, NOT A CSS BACKGROUND, and re-validated here. The string was
  // written by one account and is rendered on everyone else's screen; a data
  // URI dropped into a style attribute is a place for a host to write CSS that
  // runs on a stranger's page. The database constrains the column to this
  // shape too -- this is the second of the two checks, not the only one.
  const fill = p.frame && FRAME_URI.test(p.frame)
    ? `<img class="fill" src="${esc(p.frame)}" alt="" loading="lazy" decoding="async"
            style="object-fit:cover;width:100%;height:100%">`
    : `<div class="fill frameSlot"></div>`;
  return `<div class="pCard">
    <div class="art">
      ${fill}
      <div class="tl">
        <span class="pill live"><span class="d"></span>Live</span>
        <span class="pill">${p.joined_count} watching</span>
      </div>
      ${p.seat_limit != null ? `<div class="tr"><span class="pill seats${full ? " full" : ""}">${p.joined_count}/${p.seat_limit} seats</span></div>` : ""}
      <button class="joinCta" data-join="${esc(p.join_code)}">${full ? "Full" : "Join"}</button>
    </div>
    <div class="pMeta">
      <div class="pTitle">${esc(p.title || "Untitled")}</div>
      <button class="hostLink hostRow"${p.host_handle ? ` data-host="${esc(p.host_handle)}"` : ""} title="${p.host_handle ? `See ${esc(host)}'s profile` : "This host has no public profile"}">
        <span class="hAv" style="background:${av(host)}">${esc(initial(host))}</span>
        <span class="hName">${esc(host)}</span>
        ${p.following ? '<span class="hFollow">Following</span>' : ""}
        <span class="hDot">&middot;</span>
        <span class="hTime">${ago(mins)}</span>
      </button>
      ${p.blurb ? `<div class="blurb">${esc(p.blurb)}</div>` : ""}
      <div class="chips">
        ${p.rating ? `<span class="chip">${esc(p.rating)}</span>` : ""}
        ${p.genre ? `<span class="chip">${esc(p.genre)}</span>` : ""}
        ${p.social_platform ? `<span class="chip social">${esc(p.social_platform)}</span>` : ""}
      </div>
    </div>
  </div>`;
}

function noneMsg(kind: string): string {
  return `<div class="empty">
    <div class="glyph"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#c5f04e" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
    <h3>No ${esc(kind)} parties match</h3>
    <p>Nothing open fits those filters right now. Loosen one, or start the party yourself and it appears here for everyone else.</p>
    <div class="acts"><button class="btn" data-clearfilters>Clear filters</button><button class="btn primary" data-start>Start a party</button></div>
  </div>`;
}

const noneRow = (t: string) =>
  `<div class="person" style="grid-template-columns:1fr"><small style="font-size:12px;color:var(--dim);line-height:1.5">${esc(t)}</small></div>`;

const NOTE_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

const REASON_LABEL: Record<string, string> = {
  technical: "Connection trouble",
  space: "Making room for someone else",
  fit: "Not the right fit for this party",
  conduct: "Behaviour in the party",
};

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

let openSeq = 0;

async function loadOpen(): Promise<void> {
  const seq = ++openSeq;
  const rows = await listPublicParties(F);
  // A slower earlier query must not overwrite a faster later one. Typing in the
  // search box fires several of these and they do not come back in order.
  if (seq !== openSeq || !root) return;
  open = rows;
  totalOpen = rows[0]?.total_rows ?? (activeCount() ? totalOpen : rows.length);
  paintOpen();
  paintChrome();
}

async function loadFacets(): Promise<void> {
  const f = await publicPartyFacets();
  if (!root) return;
  fill("#fGenre", f.genre || []);
  fill("#fRating", f.rating || []);
  fill("#fDecade", f.decade || []);
  fill("#fLang", f.language || []);
}

/** A dropdown with nothing in it is hidden rather than shown empty.
 *
 *  Decade and language have no source: the catalogue carries no release year
 *  and no audio language, so nothing writes those columns and the facet list
 *  comes back empty. A control that can only ever return nothing is worse than
 *  no control -- and this hides itself and reappears on its own the day the
 *  catalogue starts carrying the field. */
function fill(sel: string, vals: string[]): void {
  const s = $<HTMLSelectElement>(sel);
  if (!s) return;
  const keep = s.value;
  while (s.options.length > 1) s.remove(1);
  for (const v of vals) s.add(new Option(v, v));
  s.value = keep;
  const wrap = s.closest<HTMLElement>(".sel");
  if (wrap) wrap.hidden = vals.length === 0;
}

/** Everything the other three tabs need. Fired once on mount and after any
 *  action that could change it. */
async function loadSide(): Promise<void> {
  const [priv, up, blk, prof] = await Promise.all([
    myPrivateParties(), comingUp(), myBlocks(), myProfile(),
  ]);
  if (!root) return;
  privateRooms = priv; upcoming = up; blocked = blk; me = prof;
  paintPrivate();
  paintFollowing();
  paintPeople();
  paintChrome();
  void paintHostSide();
}

async function myProfile(): Promise<PublicProfile | null> {
  // The host tab is about the caller, and public_profile() is keyed on a
  // handle. Without one there is no public presence at all, which is a state
  // the panel has to render rather than fail on.
  const { data: u } = await getSupabase().auth.getUser();
  if (!u.user) return null;
  const { data } = await getSupabase().from("profiles")
    .select("public_handle").eq("id", u.user.id).maybeSingle();
  const handle = (data as any)?.public_handle;
  if (!handle) return { ok: false, error: "no handle" };
  return publicProfile(handle);
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

const activeCount = () =>
  (F.q ? 1 : 0) + (F.genre ? 1 : 0) + (F.rating ? 1 : 0) + (F.decade ? 1 : 0) +
  (F.language ? 1 : 0) + (F.size ? 1 : 0) + (F.freeSeats ? 1 : 0) +
  (F.justStarted ? 1 : 0) + (F.followsOnly ? 1 : 0) + (F.hasSocial ? 1 : 0);

function paintOpen(): void {
  const grid = $("#openGrid"); const none = $("#openNone");
  if (!grid || !none) return;
  grid.innerHTML = open.map(card).join("");
  none.innerHTML = open.length ? "" : noneMsg("open");

  const n = activeCount();
  const count = $("#fCount");
  if (count) {
    count.innerHTML = n
      ? `<b>${open.length}</b> of ${totalOpen} open parties`
      : `<b>${open.length}</b> open ${open.length === 1 ? "party" : "parties"} &middot; updated just now`;
  }
  const clear = $("#fClear"); if (clear) clear.hidden = !n;
  root?.querySelectorAll<HTMLElement>(".sel").forEach((s) => {
    const v = s.querySelector<HTMLSelectElement>("select");
    if (v && v.id !== "sort") s.classList.toggle("on", !!v.value);
  });

  // The empty panel is about the directory being quiet, not about the filters
  // being narrow. Those are different states and they get different screens.
  showPanel();
}

function paintPrivate(): void {
  const box = $("#privRows");
  if (!box) return;
  box.innerHTML = privateRooms.length
    ? privateRooms.map((r) => {
        const live = !r.ended_at;
        const who = r.is_host ? "You hosted" : `Hosted by ${esc(r.host_name || r.host_handle || "someone")}`;
        const when = live ? `Started ${ago(minsSince(r.started_at))}` : `Ended ${relDay(r.ended_at!)}`;
        return `<button class="row" style="grid-template-columns:88px 1fr auto auto auto" data-priv="${esc(r.join_code)}" data-privhost="${r.is_host ? "1" : ""}">
          <div class="thumb frameSlot"${live ? "" : ' style="opacity:.45"'}></div>
          <div class="info"><b>${esc(r.title || "Untitled")}</b><small>${who} &middot; ${esc(when)}${r.requires_approval ? " &middot; you approve each person" : ""}</small></div>
          ${live ? '<span class="pill live" style="position:static"><span class="d"></span>Live</span>' : '<span class="chip">Ended</span>'}
          <span class="codeCell">${esc(r.join_code)}</span>
          <span class="btn ${live ? "primary" : ""} sm" style="pointer-events:none">${live ? "Open" : "Host again"}</span>
        </button>`;
      }).join("")
    : `<div class="row" style="grid-template-columns:1fr;cursor:default"><div class="info"><b>No private rooms yet</b><small>A room you host or are let into shows up here for thirty days, with its code.</small></div></div>`;

  const n = $("#nPriv");
  if (n) n.textContent = String(privateRooms.filter((r) => !r.ended_at).length);
}

function relDay(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

function paintFollowing(): void {
  const grid = $("#followGrid");
  const box = $("#comingUp");
  if (!grid || !box) return;

  const live = open.filter((p) => p.following);
  grid.innerHTML = live.length
    ? live.map((p, i) => card(p, i + 2)).join("")
    : '<div class="rows"><div class="row" style="grid-template-columns:1fr;cursor:default"><div class="info"><b>None of them is live right now</b><small>Coming up below shows when each one usually hosts.</small></div></div></div>';

  const nf = $("#nFollow"); if (nf) nf.textContent = String(live.length);

  box.innerHTML = upcoming.length
    ? upcoming.map((h) => {
        const when = h.next_at ? new Date(h.next_at) : null;
        const m = when ? when.toLocaleString(undefined, { month: "short" }) : null;
        const d = when ? when.getDate() : null;
        // Converted to the READER'S zone, which is the whole point of storing a
        // zone on the host rather than a wall-clock string.
        const rel = when ? relFuture(when) : "—";
        const slot = h.weekday != null && h.hour != null
          ? `${WEEKDAYS[h.weekday]}s around ${hour12(h.hour)}`
          : "Hosts occasionally";
        return `<div class="up">
          ${when ? `<div class="cal"><div class="m">${esc(m!)}</div><div class="d">${d}</div></div>`
                 : '<div class="cal"><div class="m">&middot;&middot;&middot;</div><div class="d" style="color:var(--dim)">?</div></div>'}
          <button class="hostLink"${h.handle ? ` data-host="${esc(h.handle)}"` : ""} style="flex-direction:column;align-items:flex-start;gap:3px;min-width:0">
            <b class="hName" style="font:600 13.5px/1.3 var(--font-body);color:#fff">${esc(h.handle || h.name)}</b>
            <small style="font-size:11.5px;color:var(--dim)">${h.live ? "Live now" : esc(slot)}</small>
          </button>
          <div class="when">${esc(rel)}</div>
          ${h.weekday == null
            ? ""
            : `<button class="btn sm${h.reminded ? " following" : ""}" data-remind="${esc(h.host_user_id)}" aria-pressed="${h.reminded}">${h.reminded ? "Reminder set" : "Remind me"}</button>`}
        </div>`;
      }).join("")
    : '<div class="row" style="grid-template-columns:1fr;cursor:default"><div class="info"><b>Nobody to expect yet</b><small>Follow a host and their usual slot shows up here.</small></div></div>';
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hour12 = (h: number) => (h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`);

function relFuture(d: Date): string {
  const days = Math.round((d.getTime() - Date.now()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

// ---------------------------------------------------------------------------
// The Host tab
// ---------------------------------------------------------------------------

function paintPeople(): void {
  const live = hosting();
  const watching = live ? roster.watching : [];
  const waiting = live ? roster.waiting : [];

  setText("#nRoom", String(watching.length));
  const nk = $("#nKnock");
  if (nk) { nk.textContent = String(waiting.length); nk.classList.toggle("hot", waiting.length > 0); }
  setText("#nBlocked", String(blocked.length));
  const appeals = blocked.filter((b) => b.appeal);
  const na = $("#nAppeals");
  if (na) { na.textContent = String(appeals.length); na.classList.toggle("hot", appeals.length > 0); }

  const rs = $("#roomState");
  if (rs) { rs.textContent = live ? "Live now" : "No party running"; rs.className = live ? "tag ok" : "tag"; }

  const inRoom = $("#inRoom");
  if (inRoom) {
    inRoom.innerHTML = watching.length
      ? watching.map((p) => `<div class="person">
          <span class="pAv" style="background:${av(p.name)}">${esc(initial(p.name))}</span>
          <div class="pWho"><div class="pLine"><b>${esc(p.name)}</b></div></div>
          <div class="pActs">
            <button class="btn sm" data-note="${esc(p.userId)}" data-notename="${esc(p.name)}">Add note</button>
            <button class="btn sm danger" data-remove="${esc(p.userId)}" data-removename="${esc(p.name)}">Remove</button>
          </div>
        </div>`).join("")
      : noneRow("No party running. The roster appears here the moment you start one.");
  }

  // Section 5 of the backend notes: the same cap, tail and bulk pair the green
  // room already has. A link posted into a group chat arrives all at once.
  const KNOCK_LIST_MAX = 6;
  const shown = waiting.slice(0, KNOCK_LIST_MAX);
  const kp = $("#knockPanel");
  if (kp) {
    kp.innerHTML = waiting.length
      ? `<div class="bulkBar">
          <span class="bulkTxt"><b>${waiting.length} ${waiting.length === 1 ? "person" : "people"}</b> ${waiting.length === 1 ? "is" : "are"} waiting. A link in a group chat arrives all at once.</span>
          <div class="pActs"><button class="btn sm primary" data-bulk="admit">Let everyone in</button><button class="btn sm danger" data-bulk="refuse">Refuse all</button></div>
        </div>` +
        shown.map((p) => `<div class="person">
          <span class="pAv" style="background:${av(p.name)}">${esc(initial(p.name))}</span>
          <div class="pWho"><div class="pLine"><b>${esc(p.name)}</b></div></div>
          <div class="pActs"><button class="btn sm primary" data-knock="admit" data-user="${esc(p.userId)}">Let in</button><button class="btn sm" data-knock="refuse" data-user="${esc(p.userId)}">No</button></div>
        </div>`).join("") +
        (waiting.length > shown.length ? noneRow(`and ${waiting.length - shown.length} more waiting`) : "") +
        `<div class="blockNote" style="border-top:1px solid #1a2030;border-bottom:none">Showing the first ${shown.length}. The bulk buttons act on all ${waiting.length}, including the ones not listed. People waiting do not use a seat.</div>`
      : noneRow("Nobody at the door. Knocks only arrive while a room is open.");
  }

  const bb = $("#blocked");
  if (bb) {
    bb.innerHTML = blocked.length
      ? blocked.map((p) => `<div class="person">
          <span class="pAv" style="background:${av(p.name)};opacity:.5">${esc(initial(p.name))}</span>
          <div class="pWho">
            <div class="pLine"><b>${esc(p.handle || p.name)}</b><span class="tag ban">${esc(REASON_LABEL[p.reason] || p.reason)}</span></div>
            <div class="pLine"><small>${esc(relDay(p.created_at))}${p.party_title ? `, during ${esc(p.party_title)}` : ""}</small></div>
            ${p.note ? `<div class="note">${NOTE_ICON}<span>${esc(p.note)}</span></div>` : ""}
          </div>
          <div class="pActs">
            <button class="btn sm" data-note="${esc(p.user_id)}" data-notename="${esc(p.name)}" data-notetext="${esc(p.note || "")}">${p.note ? "Edit note" : "Add note"}</button>
            <button class="btn sm primary" data-unblock="${esc(p.user_id)}" data-uname="${esc(p.handle || p.name)}">Unblock</button>
          </div>
        </div>`).join("")
      : noneRow("Nobody is blocked. Removing someone for conduct or fit puts them here, and it stays there after the party closes.");
  }

  const ab = $("#appeals");
  if (ab) {
    ab.innerHTML = appeals.length
      ? appeals.map((p) => `<div class="person">
          <span class="pAv" style="background:${av(p.name)};opacity:.5">${esc(initial(p.name))}</span>
          <div class="pWho">
            <div class="pLine"><b>${esc(p.handle || p.name)}</b><span class="tag ban">${esc(REASON_LABEL[p.reason] || p.reason)}</span><small>asked ${esc(relDay(p.appeal_at || p.created_at))}</small></div>
            <div class="appeal">${esc(p.appeal!)}</div>
          </div>
          <div class="pActs">
            <button class="btn sm primary" data-unblock="${esc(p.user_id)}" data-uname="${esc(p.handle || p.name)}">Unblock</button>
            <button class="btn sm" data-keepblocked="${esc(p.user_id)}">Keep blocked</button>
          </div>
        </div>`).join("")
      : noneRow("Nothing to answer. A blocked person may send one short message asking to come back.");
  }

  const nh = $("#nHost");
  if (nh) nh.textContent = String(appeals.length + waiting.length + reqCount);
}

/** Only what the account can actually answer. Repainted separately from the
 *  rest of the tab because "parties hosted" arrives on a different round trip
 *  and would otherwise sit at zero until the next mount. */
function paintStats(): void {
  const stats = $("#hostStats");
  if (!stats) return;
  const bal = credits?.balance ?? 0;
  const cap = credits?.cap ?? 0;
  const pct = cap > 0 ? Math.min(100, Math.round((bal / cap) * 100)) : 0;
  stats.innerHTML = `
    <div class="statCard"><span class="k">Followers</span><span class="v">${me?.followers ?? 0}</span><span class="s">${me?.handle ? "@" + esc(me.handle) : "No public handle yet"}</span></div>
    <div class="statCard accent"><span class="k">Hours left</span><span class="v">${hoursMins(bal)}${cap ? ` <small>of ${Math.round(cap / 60)}h</small>` : ""}</span><div class="meter"><i style="width:${pct}%"></i></div><span class="s">${credits?.exempt ? "Unmetered on your plan" : "Refills monthly"}</span></div>
    <div class="statCard"><span class="k">Parties hosted</span><span class="v">${myParties.length}</span><span class="s">${myParties.length ? `Most recent ${esc(relDay(myParties[0]!.created_at))}` : "None yet"}</span></div>
    <div class="statCard"><span class="k">Recommendations</span><span class="v">${picks.length}</span><span class="s">Shown on your profile</span></div>`;
}

let reqCount = 0;
let credits: Awaited<ReturnType<typeof partyCreditSummary>> = null;
let picks: Array<{ content_id: string; title: string | null; poster: string | null }> = [];

async function paintHostSide(): Promise<void> {
  const [sugg, cr, pk] = await Promise.all([
    mySuggestions(), partyCreditSummary(), myPicks(),
  ]);
  if (!root) return;
  credits = cr; picks = pk;

  reqCount = sugg.length;
  setText("#nReq", String(sugg.length));
  const req = $("#requests");
  if (req) {
    req.innerHTML = sugg.length
      ? sugg.map((r) => `<div class="req">
          <div class="votes"><b>${r.votes}</b><span>asked</span></div>
          <div class="thumb frameSlot"></div>
          <div class="info"><b>${esc(r.title || r.content_id)}</b><small>newest ${esc(relDay(r.newest))}</small></div>
          <div class="reqActs"><button class="btn sm primary" data-hostthis="${esc(r.content_id)}">Host this</button></div>
        </div>`).join("")
      : noneRow("Nothing asked for yet. Followers can point at a title from your public profile.");
  }

  paintStats();
  const shelf = $("#shelf");
  if (shelf) {
    shelf.innerHTML =
      picks.slice(0, 5).map((p) => `<div class="p"${p.poster ? ` style="background-image:url('${esc(p.poster)}');background-size:cover;background-position:center"` : ""} title="${esc(p.title || "")}"></div>`).join("") +
      '<button class="add" data-addpick aria-label="Add a recommendation">+</button>';
  }

  // The itemised ledger has no reader yet -- party_credit_ledger records every
  // grant, purchase and spend and nothing displays it. Saying so is better than
  // an empty box that looks broken, and much better than inventing rows.
  const ledger = $("#ledger");
  if (ledger) {
    ledger.innerHTML = credits
      ? `<div class="ldg"><div class="w">Balance<small>${credits.exempt ? "Not metered on your plan" : "Refills monthly"}</small></div><div class="d plus">${hoursMins(credits.balance)}</div></div>
         <div class="ldg"><div class="w">Used this cycle<small>Across every party you ran</small></div><div class="d">${hoursMins(credits.spent)}</div></div>
         <div class="ldg"><div class="w">Granted this cycle<small>Allowance and top-ups</small></div><div class="d plus">${hoursMins(credits.accrued)}</div></div>
         <div class="blockNote" style="border-bottom:none">The party-by-party breakdown is recorded but has no reader yet.</div>`
      : noneRow("No credit record yet. It appears the first time you host.");
  }

  paintSlot();
  paintMyProfile();
  paintMyParties();
}

const hoursMins = (mins: number) => {
  const m = Math.max(0, Math.round(mins));
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` : `${m}m`;
};

function paintSlot(): void {
  const box = $("#sched");
  if (!box) return;
  const wd = me?.hostsWeekday ?? null;
  const hr = (me as any)?.hostsHour ?? null;
  const tz = (me as any)?.hostsTz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const has = wd != null && hr != null;

  box.innerHTML = `
    <div class="schedNow">
      <div class="cal"><div class="m">${has ? "Next" : "···"}</div><div class="d"${has ? "" : ' style="color:var(--dim)"'}>${has ? WEEKDAYS[wd]!.slice(0, 2) : "?"}</div></div>
      <div class="t"><b>${has ? `${WEEKDAYS[wd]}s around ${hour12(hr)}` : "No fixed slot"}</b><small>${has ? `Shown to ${me?.followers ?? 0} followers` : "Setting one tells your followers when to come back"}</small></div>
    </div>
    <div class="fieldRow">
      <div class="field"><label for="sDay">Day</label>
        <select id="sDay">
          <option value="">No fixed day</option>
          ${WEEKDAYS.map((d, i) => `<option value="${i}"${wd === i ? " selected" : ""}>${d}s</option>`).join("")}
        </select></div>
      <div class="field"><label for="sHour">Time</label>
        <select id="sHour">
          ${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${hr === h ? " selected" : ""}>${hour12(h)}</option>`).join("")}
        </select></div>
    </div>
    <div class="field"><label for="sTz">Time zone</label>
      <input id="sTz" value="${esc(tz || "UTC")}" spellcheck="false"></div>
    <div style="display:flex;gap:8px"><button class="btn sm primary" id="saveSlot">Save slot</button></div>`;
}

function paintMyProfile(): void {
  const box = $("#myProfile");
  if (!box) return;
  box.innerHTML = me?.ok
    ? `<div class="profCard">
        <div class="handle"><span class="at">@</span><b>${esc(me.handle || "")}</b>${me.platform ? `<span class="chip social">${esc(me.platform)}</span>` : ""}</div>
        <p style="margin:0;font-size:12.5px;line-height:1.55;color:var(--dim);text-wrap:pretty">${me.bio ? esc(me.bio) : "No bio yet."}${me.region ? ` Region <strong style="color:var(--text)">${esc(me.region)}</strong> — people outside it cannot join what you host.` : ""}</p>
        <div style="display:flex;gap:8px">
          <button class="btn sm" data-host="${esc(me.handle || "")}">View as visitor</button>
        </div>
      </div>`
    : `<div class="profCard">
        <div class="handle"><b style="color:var(--dim)">No public handle</b></div>
        <p style="margin:0;font-size:12.5px;line-height:1.55;color:var(--dim)">You have no public presence until you claim one. Nobody can follow you, and nothing you host can be linked back to a page.</p>
      </div>`;
}

let myParties: Array<{ id: string; title: string | null; join_code: string; created_at: string; ended_at: string | null; is_public: boolean }> = [];

function paintMyParties(): void {
  const box = $("#yoursRows");
  if (!box) return;
  box.innerHTML = myParties.length
    ? myParties.slice(0, 8).map((r) => {
        const live = !r.ended_at;
        const mins = r.ended_at
          ? Math.round((new Date(r.ended_at).getTime() - new Date(r.created_at).getTime()) / 60000)
          : minsSince(r.created_at);
        return `<button class="row" data-again="${esc(r.join_code)}" data-againlive="${live ? "1" : ""}">
          <div class="thumb frameSlot"></div>
          <div class="info"><b>${esc(r.title || "Untitled")}</b><small>${live ? "Running now" : esc(relDay(r.ended_at!))} &middot; ${r.is_public ? "listed publicly" : "private"}</small></div>
          <div class="stat"><b>${hoursMins(mins)}</b>watched</div>
          <span class="btn ${live ? "primary" : ""} sm" style="pointer-events:none">${live ? "Rejoin" : "Host again"}</span>
        </button>`;
      }).join("")
    : noneRow("Nothing yet. Anything you host shows up here with what it cost.");
}

async function loadMyParties(): Promise<void> {
  const { data: u } = await getSupabase().auth.getUser();
  if (!u.user) return;
  const { data } = await getSupabase().from("parties")
    .select("id, title, join_code, created_at, ended_at, is_public")
    .eq("host_user_id", u.user.id)
    .order("created_at", { ascending: false })
    .limit(20);
  myParties = (data ?? []) as any[];
  if (root) { paintMyParties(); paintStats(); }
}

// ---------------------------------------------------------------------------
// Chrome: the live count, the strip, and the one-party-at-a-time button
// ---------------------------------------------------------------------------

function paintChrome(): void {
  const code = activePartyCode();
  const host = hosting();

  const lc = $("#liveCount");
  if (lc) {
    lc.hidden = false;
    lc.querySelector("span:last-child")!.textContent =
      `${totalOpen} live now`;
  }

  const strip = $("#strip");
  if (strip) {
    strip.hidden = !host || !code;
    root!.classList.toggle("hasStrip", host && !!code);
    if (host && code) {
      setText("#stripTitle", recentParty()?.title || "your party");
      setText("#stripCode", code);
      const appeals = blocked.filter((b) => b.appeal).length;
      setText("#stripSub", [
        `${viewers} watching`,
        roster.waiting.length ? `${roster.waiting.length} at the door` : "",
        appeals ? `${appeals} asking to return` : "",
      ].filter(Boolean).join(" · "));
    }
  }

  // ONE PARTY AT A TIME, now enforced by a partial unique index in the
  // database. While one is running the only thing this button can honestly
  // offer is a way back to it.
  const btn = $<HTMLButtonElement>("#startBtn");
  if (btn) {
    setText("#startLabel", host ? "Already hosting" : "Start a party");
    btn.classList.toggle("primary", !host);
    btn.title = host ? "You can host one party at a time. End the one you have before starting another." : "";
  }

  setText("#nOpen", String(open.length));
}

function setText(sel: string, s: string): void {
  const el = $(sel);
  if (el) el.textContent = s;
}

function showPanel(): void {
  if (!root) return;
  // The directory being quiet and the filters being narrow are different
  // states, and they get different screens: open-empty is about there being
  // nothing on at all.
  const empty = tab === "open" && totalOpen === 0 && activeCount() === 0;
  const panel = onProfile ? "profile" : empty ? "open-empty" : tab;
  root.querySelectorAll<HTMLElement>("[data-panel]").forEach((s) => {
    s.hidden = s.dataset.panel !== panel;
  });
  const fb = $("#filterBar");
  if (fb) fb.hidden = onProfile || tab !== "open" || empty;
}

// ---------------------------------------------------------------------------
// A host's public page, in place
// ---------------------------------------------------------------------------

async function openHostProfile(handle: string): Promise<void> {
  const p = await publicProfile(handle);
  const body = $("#profBody");
  if (!body || !root) return;

  if (!p.ok) {
    body.innerHTML = `<div class="empty"><h3>No such profile</h3><p>${esc(p.error || "That handle does not exist.")}</p></div>`;
  } else {
    const live = p.live?.[0] || null;
    const slot = p.hostsWeekday != null && (p as any).hostsHour != null
      ? `${WEEKDAYS[p.hostsWeekday]}s around ${hour12((p as any).hostsHour)}` : null;
    const myRegion = me?.region || null;
    body.innerHTML = `
      <div class="profTop">
        <div class="profAv" style="background:${av(p.name || handle)}">${esc(initial(p.name || handle))}</div>
        <div class="profWho">
          <div class="profName"><h1>${esc(p.name || handle)}</h1><span class="at">@${esc(handle)}</span>${p.isSelf ? '<span class="tag ok">This is you</span>' : ""}</div>
          <div class="profFacts">
            <span class="fact"><b>${p.followers ?? 0}</b> followers</span>
            ${p.region ? `<span class="fact">Region <b>${esc(p.region)}</b></span>` : ""}
            ${slot ? `<span class="fact">Usually hosts <b>${esc(slot)}</b></span>` : '<span class="fact">No fixed slot</span>'}
          </div>
          ${p.bio ? `<p class="profBio">${esc(p.bio)}</p>` : '<p class="profBio" style="opacity:.6">No bio yet.</p>'}
          ${p.region && myRegion && p.region !== myRegion ? `<p class="profBio" style="color:var(--star);opacity:.85">They host in ${esc(p.region)}. Region-locked titles they play may not be joinable from yours.</p>` : ""}
        </div>
        <div class="profActs">
          ${p.isSelf ? ""
            : `<button class="btn ${p.following ? "following" : "primary"}" data-follow="${esc(p.userId || "")}" aria-pressed="${!!p.following}">${p.following ? "Following" : "Follow"}</button>
               <button class="btn" data-report="${esc(handle)}">Report</button>`}
        </div>
      </div>

      ${live ? `<div class="liveStrip">
        <span class="pill live" style="position:static"><span class="d"></span>Live</span>
        <div class="t"><b>${esc(live.title)}</b><small>${live.watching} watching &middot; ${ago(minsSince(live.startedAt))}${live.blurb ? " &middot; " + esc(live.blurb) : ""}</small></div>
        <button class="btn primary" data-join="${esc(live.joinCode)}">${p.isSelf ? "Back to the party" : "Join now"}</button>
      </div>` : `<div class="explain" style="margin-bottom:24px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8a93a3" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <p>Not hosting right now.${slot ? ` Their usual slot is ${esc(slot)}, so following puts the next one at the top of your Coming up.` : " Following will tell you when they start something."}</p>
      </div>`}

      ${p.picks?.length ? `<div class="sectionHead"><h2>Recommendations</h2><p>Titles ${esc(p.name || handle)} vouches for, live or not.</p></div>
      <div class="shelf" style="margin-bottom:34px;max-width:640px">
        ${p.picks.map((k) => `<div class="p"${k.poster ? ` style="background-image:url('${esc(k.poster)}');background-size:cover;background-position:center"` : ""} title="${esc(k.title || "")}"></div>`).join("")}
      </div>` : ""}

      <div class="sectionHead"><h2>Recent public parties</h2><p>Private rooms never appear here.</p></div>
      <div class="rows" style="margin-bottom:28px">
        ${p.recent?.length
          ? p.recent.map((t) => `<div class="row" style="grid-template-columns:88px 1fr auto">
              <div class="thumb frameSlot"></div>
              <div class="info"><b>${esc(t)}</b></div>
            </div>`).join("")
          : `<div class="row" style="grid-template-columns:1fr;cursor:default"><div class="info"><b>No public parties yet</b><small>Anything they have hosted was private, so it never appears here.</small></div></div>`}
      </div>`;
  }

  onProfile = true;
  root.querySelectorAll<HTMLElement>(".tab").forEach((x) => x.setAttribute("aria-selected", "false"));
  setText("#profBackLabel", "Back to " + ({
    open: "Open parties", private: "Private", following: "Hosts you follow", host: "Host",
  }[lastTab] || "Open parties"));
  showPanel();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------------
// Wiring. One delegated listener, so anything a repaint replaces still works.
// ---------------------------------------------------------------------------

function wire(): void {
  if (!root) return;

  // -- tabs ----------------------------------------------------------------
  root.querySelectorAll<HTMLElement>(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      onProfile = false;
      tab = (t.dataset.tab as Tab) || "open";
      lastTab = tab;
      root!.querySelectorAll<HTMLElement>(".tab").forEach((x) =>
        x.setAttribute("aria-selected", String(x === t)));
      showPanel();
      if (tab === "host") void loadMyParties();
    });
  });

  root.querySelectorAll<HTMLElement>(".seg").forEach((s) => {
    s.addEventListener("click", () => {
      root!.querySelectorAll<HTMLElement>(".seg").forEach((x) =>
        x.setAttribute("aria-selected", String(x === s)));
      root!.querySelectorAll<HTMLElement>("[data-seg-panel]").forEach((p) => {
        p.hidden = p.dataset.segPanel !== s.dataset.seg;
      });
    });
  });

  $("#profBack")?.addEventListener("click", () => {
    onProfile = false;
    tab = lastTab;
    root!.querySelectorAll<HTMLElement>(".tab").forEach((x) =>
      x.setAttribute("aria-selected", String(x.dataset.tab === lastTab)));
    showPanel();
  });

  // -- the filter bar. Every change is a query, debounced for typing. -------
  let qTimer: number | undefined;
  const qInput = $<HTMLInputElement>("#q");
  qInput?.addEventListener("input", () => {
    F.q = qInput.value.trim();
    const clr = $("#qClr"); if (clr) clr.hidden = !F.q;
    clearTimeout(qTimer);
    qTimer = window.setTimeout(() => void loadOpen(), 220);
  });
  $("#qClr")?.addEventListener("click", () => {
    F.q = ""; if (qInput) qInput.value = "";
    const clr = $("#qClr"); if (clr) clr.hidden = true;
    void loadOpen();
  });

  const bindSel = (sel: string, key: keyof PartyFilters) => {
    $<HTMLSelectElement>(sel)?.addEventListener("change", (e) => {
      (F as any)[key] = (e.target as HTMLSelectElement).value;
      void loadOpen();
    });
  };
  bindSel("#fGenre", "genre"); bindSel("#fRating", "rating");
  bindSel("#fDecade", "decade"); bindSel("#fLang", "language");
  bindSel("#fSize", "size"); bindSel("#sort", "sort");

  ([["#tSeats", "freeSeats"], ["#tNew", "justStarted"], ["#tFollow", "followsOnly"], ["#tSocial", "hasSocial"]] as const)
    .forEach(([sel, key]) => {
      $(sel)?.addEventListener("click", (e) => {
        const b = e.currentTarget as HTMLElement;
        (F as any)[key] = !(F as any)[key];
        b.setAttribute("aria-pressed", String((F as any)[key]));
        void loadOpen();
      });
    });

  $("#fClear")?.addEventListener("click", clearFilters);

  // -- join by code, in both places ----------------------------------------
  wireCode("#barCode", "#barJoin");
  wireCode("#bigCode", "#bigJoin");

  $("#startBtn")?.addEventListener("click", () => void startParty());
  $("#buyHours")?.addEventListener("click", async () => {
    const { buyPartyCredits } = await import("./db");
    await buyPartyCredits();
  });

  // -- the hosting strip ---------------------------------------------------
  $("#stripBack")?.addEventListener("click", async () => {
    const c = activePartyCode(); if (!c) return;
    await resumeHosting(c);
  });
  $("#stripCopy")?.addEventListener("click", async () => {
    const c = activePartyCode(); if (!c) return;
    try { await navigator.clipboard.writeText(partyLink(c)); showToast("Party link copied"); }
    catch { showToast(`Party code ${c}`); }
  });
  $("#stripEnd")?.addEventListener("click", async () => {
    const c = activePartyCode(); if (!c) return;
    if (!confirm("End the party for everyone?")) return;
    const { closeParty } = await import("./party");
    await closeParty(c);
    showToast("Party ended");
    if (mounted) renderParty(mounted);
  });

  root.addEventListener("click", onClick);
  root.addEventListener("click", (e) => {
    const s = (e.target as HTMLElement).closest("[data-saveslot], #saveSlot");
    if (s) void saveSlot();
  });
}

function wireCode(inputSel: string, btnSel: string): void {
  const input = $<HTMLInputElement>(inputSel);
  if (!input) return;
  // Codes come from an alphabet with no O/0 or I/1, so normalising here means
  // one read aloud over voice chat still lands.
  input.addEventListener("input", () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
  });
  const go = () => {
    const c = input.value.trim();
    if (c.length !== 6) { showToast("A party code is six characters"); return; }
    void joinParty(c);
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  $(btnSel)?.addEventListener("click", go);
}

function clearFilters(): void {
  Object.assign(F, {
    q: "", genre: "", rating: "", decade: "", language: "", size: "",
    freeSeats: false, justStarted: false, followsOnly: false, hasSocial: false,
  });
  const qi = $<HTMLInputElement>("#q"); if (qi) qi.value = "";
  const clr = $("#qClr"); if (clr) clr.hidden = true;
  ["#fGenre", "#fRating", "#fDecade", "#fLang", "#fSize"].forEach((s) => {
    const el = $<HTMLSelectElement>(s); if (el) el.value = "";
  });
  ["#tSeats", "#tNew", "#tFollow", "#tSocial"].forEach((s) =>
    $(s)?.setAttribute("aria-pressed", "false"));
  void loadOpen();
}

async function startParty(): Promise<void> {
  if (hosting()) {
    const c = activePartyCode();
    showToast("You are already hosting. One party at a time.");
    if (c) await resumeHosting(c);
    return;
  }
  const { pickSheet } = await import("./party-setup");
  const pick = await pickSheet("Start a party");
  if (!pick) return;
  const { startWatchParty } = await import("./vod");
  const started = await startWatchParty(pick.item, pick.streamIdx);
  if (started && mounted) renderParty(mounted);
}

async function saveSlot(): Promise<void> {
  const day = $<HTMLSelectElement>("#sDay")?.value ?? "";
  const hr = $<HTMLSelectElement>("#sHour")?.value ?? "";
  const tz = $<HTMLInputElement>("#sTz")?.value.trim() || null;
  const ok = await saveProfileExtras({
    region: me?.region ?? null,
    weekday: day === "" ? null : Number(day),
    hour: day === "" ? null : Number(hr),
    tz: day === "" ? null : tz,
  });
  showToast(ok ? "Slot saved" : "Could not save that");
  if (ok) { me = await myProfile(); paintSlot(); }
}

async function onClick(e: Event): Promise<void> {
  const t = e.target as HTMLElement;

  const host = t.closest<HTMLElement>("[data-host]");
  if (host?.dataset.host) {
    if (!onProfile) lastTab = tab;
    await openHostProfile(host.dataset.host);
    return;
  }

  const join = t.closest<HTMLElement>("[data-join]");
  if (join?.dataset.join) { void joinParty(join.dataset.join); return; }

  const priv = t.closest<HTMLElement>("[data-priv]");
  if (priv?.dataset.priv) {
    const code = priv.dataset.priv;
    if (priv.dataset.privhost) await resumeHosting(code);
    else await joinParty(code);
    return;
  }

  const again = t.closest<HTMLElement>("[data-again]");
  if (again?.dataset.again) {
    if (again.dataset.againlive) await resumeHosting(again.dataset.again);
    else showToast("Pick it again from the catalogue to run it a second time");
    return;
  }

  if (t.closest("[data-start]")) { void startParty(); return; }
  if (t.closest("[data-browse]")) {
    document.querySelector<HTMLElement>('[data-view="moviesView"]')?.click();
    return;
  }
  if (t.closest("[data-clearfilters]")) { clearFilters(); return; }

  const foll = t.closest<HTMLElement>("[data-follow]");
  if (foll?.dataset.follow) {
    const on = foll.getAttribute("aria-pressed") !== "true";
    const ok = await followHost(foll.dataset.follow, on);
    if (!ok) { showToast("Could not change that"); return; }
    foll.setAttribute("aria-pressed", String(on));
    foll.textContent = on ? "Following" : "Follow";
    foll.classList.toggle("following", on);
    foll.classList.toggle("primary", !on);
    showToast(on ? "Following. Their next party goes to the top." : "Unfollowed.");
    void loadOpen();
    void loadSide();
    return;
  }

  const rem = t.closest<HTMLElement>("[data-remind]");
  if (rem?.dataset.remind) {
    const on = rem.getAttribute("aria-pressed") !== "true";
    const ok = await setReminder(rem.dataset.remind, on);
    if (!ok) { showToast("Could not set that"); return; }
    rem.setAttribute("aria-pressed", String(on));
    rem.textContent = on ? "Reminder set" : "Remind me";
    rem.classList.toggle("following", on);
    // Deliberately honest about what a reminder is: it fires when they start
    // something, not when their slot comes round. Nobody promised to be there.
    showToast(on ? "You will hear from us when they actually go live." : "Reminder removed.");
    return;
  }

  const rep = t.closest<HTMLElement>("[data-report]");
  if (rep?.dataset.report) {
    const why = prompt("Why are you reporting this profile? impersonation, abusive, spam, adult, other");
    if (!why) return;
    const { reportProfile } = await import("./party");
    const ok = await reportProfile(rep.dataset.report, why.trim().toLowerCase());
    showToast(ok ? "Reported. That goes to us, not to them." : "Could not file that");
    return;
  }

  const unb = t.closest<HTMLElement>("[data-unblock]");
  if (unb?.dataset.unblock) {
    const who = unb.dataset.uname || "They";
    const ok = await unblockUser(unb.dataset.unblock);
    if (!ok) { showToast("Could not lift that"); return; }
    // Data first, then repaint: unblocking clears the block AND any appeal
    // against it, so the queue cannot show a request with nothing behind it.
    blocked = blocked.filter((b) => b.user_id !== unb.dataset.unblock);
    paintPeople();
    showToast(`${who} can join your parties again.`);
    return;
  }

  const keep = t.closest<HTMLElement>("[data-keepblocked]");
  if (keep?.dataset.keepblocked) {
    const ok = await answerAppeal(keep.dataset.keepblocked, false);
    if (!ok) { showToast("Could not answer that"); return; }
    blocked = blocked.map((b) =>
      b.user_id === keep.dataset.keepblocked ? { ...b, appeal: null } : b);
    paintPeople();
    showToast("Kept blocked. They are not told.");
    return;
  }

  const note = t.closest<HTMLElement>("[data-note]");
  if (note?.dataset.note) {
    const body = prompt(`Private note about ${note.dataset.notename || "them"}. Only you ever see it.`,
      note.dataset.notetext || "");
    if (body == null) return;
    const ok = await setPartyNote(note.dataset.note, body);
    if (!ok) { showToast("Could not save that"); return; }
    blocked = await myBlocks();
    paintPeople();
    showToast(body.trim() ? "Note saved" : "Note cleared");
    return;
  }

  const knock = t.closest<HTMLElement>("[data-knock]");
  if (knock?.dataset.user) {
    const { respondToKnock } = await import("./party");
    respondToKnock(knock.dataset.user, knock.dataset.knock === "admit");
    return;
  }

  const bulk = t.closest<HTMLElement>("[data-bulk]");
  if (bulk?.dataset.bulk) {
    const admit = bulk.dataset.bulk === "admit";
    const { respondToKnock } = await import("./party");
    // The FULL waiting array, not the visible slice. The list is capped at six;
    // the button says it acts on all of them, so it has to.
    for (const w of roster.waiting) respondToKnock(w.userId, admit);
    showToast(admit ? "Everyone waiting was let in" : "Everyone waiting was refused");
    return;
  }

  const remove = t.closest<HTMLElement>("[data-remove]");
  if (remove?.dataset.remove) {
    const who = remove.dataset.removename || "them";
    const reason = prompt(
      `Remove ${who}. Why?\n\ntechnical - connection trouble (they can come back)\nspace - making room (they can come back)\nfit - not the right fit (blocked)\nconduct - behaviour (blocked)`,
      "technical");
    if (!reason || !REASON_LABEL[reason]) return;
    const { kickViewer } = await import("./party");
    kickViewer(remove.dataset.remove, reason);
    if (reason === "fit" || reason === "conduct") {
      // The block is written by kickViewer; re-read so the Blocked segment is
      // right immediately rather than on the next mount.
      setTimeout(() => { void myBlocks().then((b) => { blocked = b; paintPeople(); }); }, 400);
    }
    return;
  }

  const hostThis = t.closest<HTMLElement>("[data-hostthis]");
  if (hostThis) { void startParty(); return; }

  const addPick = t.closest<HTMLElement>("[data-addpick]");
  if (addPick) { showToast("Add a recommendation from a title's page"); return; }
}

/** The /@handle deep link. Mounts the whole surface and opens straight onto
 *  the profile panel, so Back lands somewhere real instead of on nothing --
 *  which is what a bare profile page did on a cold load. */
export async function renderProfilePage(el: HTMLElement, handle: string): Promise<void> {
  renderParty(el);
  lastTab = "open";
  await openHostProfile(handle);
}

// Kept for the deep-link path, which still calls it after a cold load.
export function refreshParty(): void {
  if (mounted) renderParty(mounted);
}
