import { fetchVod } from "./api";
import { openPlayer } from "./player";
import { openPartyPlayer } from "./party";
import { openVodDetails } from "./vod";
import { state } from "./state";
import { escapeHtml, $ } from "./util";
import type { Channel, VodItem } from "./types";

interface LocalTrack {
  id: string;
  title: string;
  url: string;
  type: "live" | "vod";
  poster: string | null;
  genre: string;
  summary: string;
  artist?: string;
  album?: string;
}

interface LocalPlaylist {
  name: string;
  id: string;
  tracks: string[];
}

export function renderMusic(container: HTMLElement): void {
  container.replaceChildren();

  const loading = document.createElement("div");
  loading.style.color = "var(--dim)";
  loading.style.padding = "24px";
  loading.textContent = "Tuning music catalog...";
  container.append(loading);

  const hero = $("musicHero");
  if (hero) hero.setAttribute("hidden", "");

  // Load backend catalog data
  Promise.all([
    fetchVod().catch(() => [] as any[]),
    fetch("/api/local/music").then((r) => r.json()).catch(() => ({ tracks: [], playlists: [] })),
    fetch("/api/music/npr").then((r) => r.json()).catch(() => ({ tracks: [] })),
    fetch("/api/music/archive").then((r) => r.json()).catch(() => ({ concerts: [] }))
  ]).then(([vodRails, localData, nprData, archiveData]) => {
    loading.remove();

    const localTracks: LocalTrack[] = localData.tracks || [];
    const localPlaylists: LocalPlaylist[] = localData.playlists || [];
    const nprTracks = nprData.tracks || [];
    const archiveConcerts = archiveData.concerts || [];

    // 1. Gather Live Music Channels
    const liveChannels = (state.channels || []).filter((ch: Channel) =>
      "music" in ch.categories || 
      (ch.categories && (ch.categories as any).includes("music")) ||
      (ch.categories && Array.isArray(ch.categories) && ch.categories.includes("music"))
    );

    // 2. Gather VOD Music items
    const vodMusic: VodItem[] = [];
    vodRails.forEach((rail) => {
      rail.items.forEach((item: VodItem) => {
        const text = `${item.title} ${item.genre} ${item.summary}`.toLowerCase();
        if (text.includes("music") || text.includes("musical") || text.includes("variety") || text.includes("concert")) {
          if (!vodMusic.some((v) => v.id === item.id)) {
            vodMusic.push(item);
          }
        }
      });
    });

    // Populate Spotlight Hero
    if (hero) {
      hero.className = "vodHeroBlock";
      hero.style.backgroundImage = "linear-gradient(135deg, #1e102f 0%, #07080b 100%)";
      hero.innerHTML = `
        <div class="vodHeroOverlay"></div>
        <div class="vodHeroContent">
          <span class="vodHeroGenre" style="color: var(--accent);">🎵 VEEDEEOH PARTY</span>
          <h2 class="vodHeroTitle">Continuous Mix & Ambient Visualizer</h2>
          <div class="vodHeroMeta">Seamless double-buffered gapless crossfades</div>
          <p class="vodHeroSummary">Tune into continuous DJ-mix styles across ambient, electronic, lofi, or retro playlists, driven by an audio canvas visualizer.</p>
          <div style="margin-top: 12px; display: flex; gap: 10px;">
            <button id="heroPartyChill" class="actionBtn primary" style="background: var(--accent); color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer;">🥞 CHILLOUT</button>
            <button id="heroPartyEnergy" class="actionBtn" style="background: rgba(255,255,255,0.1); border: 1px solid var(--border); color: #fff; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer;">🔥 HIGH ENERGY</button>
          </div>
        </div>
      `;
      hero.removeAttribute("hidden");

      const chillBtn = $("heroPartyChill");
      const energyBtn = $("heroPartyEnergy");
      if (chillBtn) {
        chillBtn.onclick = (e) => {
          e.stopPropagation();
          void startPartyModeWithMood("chillout");
        };
      }
      if (energyBtn) {
        energyBtn.onclick = (e) => {
          e.stopPropagation();
          void startPartyModeWithMood("high-energy");
        };
      }
    }

    // --- Rail 1: Mood Stations ---
    const moodRail = document.createElement("div");
    moodRail.className = "rail";
    moodRail.innerHTML = `
      <div class="railHead">
        <h2>Continuous Ambient Moods</h2>
        <span class="railTag">Auto-crossfade</span>
      </div>
    `;
    const moodScroller = document.createElement("div");
    moodScroller.className = "railScroll";

    const moods = [
      { name: "🥞 Chillout Station", desc: "Acoustic, lofi, chill, jazz, ambient", mood: "chillout", art: "linear-gradient(135deg, #1b263b, #0d1b2a)" },
      { name: "🔥 High Energy", desc: "Dance, pop, rock, electronic, vevo", mood: "high-energy", art: "linear-gradient(135deg, #780000, #c1121f)" },
      { name: "📺 Retro Party", desc: "'70s/'80s/classic variety & archives", mood: "retro", art: "linear-gradient(135deg, #2b2d42, #8d99ae)" }
    ];

    moods.forEach((m) => {
      const card = document.createElement("button");
      card.className = "vodCard";
      card.innerHTML = `
        <span class="vodPoster" style="background: ${m.art}; display: flex; align-items: center; justify-content: center; font-size: 32px;">🎵</span>
        <span class="vodTitle">${escapeHtml(m.name)}</span>
        <span class="vodMeta">${escapeHtml(m.desc)}</span>
      `;
      card.onclick = () => {
        void startPartyModeWithMood(m.mood);
      };
      moodScroller.append(card);
    });
    moodRail.append(moodScroller);
    container.append(moodRail);

    // --- Rail 2: NPR Tiny Desk Concerts ---
    if (nprTracks.length > 0) {
      const nprRail = document.createElement("div");
      nprRail.className = "rail";
      nprRail.innerHTML = `
        <div class="railHead">
          <h2>NPR Tiny Desk Concerts</h2>
          <span class="railTag">${nprTracks.length} sessions</span>
        </div>
      `;
      const nprScroller = document.createElement("div");
      nprScroller.className = "railScroll";

      nprTracks.forEach((t: any) => {
        const card = document.createElement("button");
        card.className = "vodCard";
        card.innerHTML = `
          <span class="vodPoster">${t.poster ? `<img loading="lazy" alt="" src="${escapeHtml(t.poster)}">` : "🎙"}</span>
          <span class="vodTitle">${escapeHtml(t.title)}</span>
          <span class="vodMeta">Acoustic Session</span>
        `;
        card.onclick = () => {
          openPartyPlayer([t], 0, "Tiny Desk");
        };
        nprScroller.append(card);
      });
      nprRail.append(nprScroller);
      container.append(nprRail);
    }

    // --- Rail 3: Legendary Live Concerts (Internet Archive) ---
    if (archiveConcerts.length > 0) {
      const archRail = document.createElement("div");
      archRail.className = "rail";
      archRail.innerHTML = `
        <div class="railHead">
          <h2>Legendary Live Concerts</h2>
          <span class="railTag">Archive.org LMA</span>
        </div>
      `;
      const archScroller = document.createElement("div");
      archScroller.className = "railScroll";

      archiveConcerts.forEach((c: any) => {
        const card = document.createElement("button");
        card.className = "vodCard";
        card.innerHTML = `
          <span class="vodPoster">${c.poster ? `<img loading="lazy" alt="" src="${escapeHtml(c.poster)}">` : "🎸"}</span>
          <span class="vodTitle">${escapeHtml(c.title)}</span>
          <span class="vodMeta">${escapeHtml(c.creator)} · ${escapeHtml(String(c.year))}</span>
        `;
        card.onclick = async () => {
          card.classList.add("loading");
          try {
            const resp = await fetch(`/api/music/archive/${c.identifier}/tracks`);
            const trackData = await resp.json();
            const tracksList = trackData.tracks || [];
            if (tracksList.length > 0) {
              openPartyPlayer(tracksList, 0, "Live Concert");
            } else {
              alert("No tracks found for this concert.");
            }
          } catch (err) {
            alert(`Failed to load concert tracks: ${err}`);
          } finally {
            card.classList.remove("loading");
          }
        };
        archScroller.append(card);
      });
      archRail.append(archScroller);
      container.append(archRail);
    }

    // --- Rail 4: Local Music Library ---
    if (localTracks.length > 0) {
      const localRail = document.createElement("div");
      localRail.className = "rail";
      localRail.innerHTML = `
        <div class="railHead">
          <h2>Local Music Library</h2>
          <span class="railTag">${localTracks.length} tracks</span>
        </div>
      `;
      const localScroller = document.createElement("div");
      localScroller.className = "railScroll";

      const allMusicCard = document.createElement("button");
      allMusicCard.className = "vodCard";
      allMusicCard.innerHTML = `
        <span class="vodPoster" style="background: linear-gradient(135deg, #3d348b, #7678ed); display: flex; align-items: center; justify-content: center; font-size: 32px;">📂</span>
        <span class="vodTitle">All Local Tracks</span>
        <span class="vodMeta">${localTracks.length} tracks detected</span>
      `;
      allMusicCard.onclick = () => {
        openPartyPlayer(localTracks as any[], 0);
      };
      localScroller.append(allMusicCard);

      localPlaylists.forEach((pl) => {
        const plistTracks = pl.tracks
          .map((tid) => localTracks.find((lt) => lt.id === tid))
          .filter(Boolean) as LocalTrack[];

        if (plistTracks.length > 0) {
          const plCard = document.createElement("button");
          plCard.className = "vodCard";
          plCard.innerHTML = `
            <span class="vodPoster" style="background: linear-gradient(135deg, #ff9f1c, #ffbf69); display: flex; align-items: center; justify-content: center; font-size: 32px;">📋</span>
            <span class="vodTitle">${escapeHtml(pl.name)}</span>
            <span class="vodMeta">${plistTracks.length} tracks</span>
          `;
          plCard.onclick = () => {
            openPartyPlayer(plistTracks as any[], 0);
          };
          localScroller.append(plCard);
        }
      });

      localRail.append(localScroller);
      container.append(localRail);
    }

    // --- Rail 5: Live Music TV ---
    if (liveChannels.length > 0) {
      const liveRail = document.createElement("div");
      liveRail.className = "rail";
      liveRail.innerHTML = `
        <div class="railHead">
          <h2>Live Music Channels</h2>
          <span class="railTag">${liveChannels.length} channels</span>
        </div>
      `;
      const liveScroller = document.createElement("div");
      liveScroller.className = "railScroll";

      liveChannels.slice(0, 30).forEach((ch: Channel) => {
        const card = document.createElement("button");
        card.className = "vodCard";
        card.innerHTML = `
          <span class="vodPoster">${ch.logo ? `<img loading="lazy" alt="" src="${escapeHtml(ch.logo)}">` : "📻"}</span>
          <span class="vodTitle">${escapeHtml(ch.name)}</span>
          <span class="vodMeta">${escapeHtml(ch.country || "GLOBAL")}</span>
        `;
        card.onclick = () => {
          openPlayer(ch as Channel);
        };
        liveScroller.append(card);
      });
      liveRail.append(liveScroller);
      container.append(liveRail);
    }

    // --- Rail 6: Concerts & VOD Musicals ---
    if (vodMusic.length > 0) {
      const vodRail = document.createElement("div");
      vodRail.className = "rail";
      vodRail.innerHTML = `
        <div class="railHead">
          <h2>Concerts & Musicals (VOD)</h2>
          <span class="railTag">${vodMusic.length} items</span>
        </div>
      `;
      const vodScroller = document.createElement("div");
      vodScroller.className = "railScroll";

      vodMusic.slice(0, 30).forEach((item) => {
        const card = document.createElement("button");
        card.className = "vodCard";
        card.innerHTML = `
          <span class="vodPoster">${item.poster ? `<img loading="lazy" alt="" src="${escapeHtml(item.poster)}">` : "🎬"}</span>
          <span class="vodTitle">${escapeHtml(item.title)}</span>
          <span class="vodMeta">${escapeHtml([item.genre, item.rating].filter(Boolean).join(" · "))}</span>
        `;
        card.onclick = () => {
          void openVodDetails(item);
        };
        vodScroller.append(card);
      });
      vodRail.append(vodScroller);
      container.append(vodRail);
    }
  });
}

async function startPartyModeWithMood(mood: string): Promise<void> {
  try {
    const resp = await fetch(`/api/party?mood=${mood}`);
    const data = await resp.json();
    const moodTracks = data.tracks || [];
    if (moodTracks.length > 0) {
      openPartyPlayer(moodTracks, 0, mood);
    } else {
      alert("No tracks found for this mood!");
    }
  } catch (err) {
    alert(`Failed to load mood station: ${err}`);
  }
}
