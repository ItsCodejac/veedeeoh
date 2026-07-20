import { fetchArchiveStream, fetchVod, fetchVodSeries } from "./api";
import { openPlayer } from "./player";
import type { Channel, Stream, VodItem } from "./types";
import { escapeHtml } from "./util";

/** Wrap a VOD item as a pseudo-channel so the existing player handles it —
 * stream picker becomes the episode picker, CC and VLC handoff work as-is. */
function asChannel(item: VodItem, streams: Stream[]): Channel {
  return {
    id: `vod:${item.id}`,
    name: item.title,
    country: null,
    categories: [],
    nsfw: false,
    logo: null,
    logos: [],
    streams,
    source: item.genre || "On Demand",
  };
}

async function playVod(item: VodItem): Promise<void> {
  if (item.url) {
    openPlayer(asChannel(item, [{ url: item.url, quality: null, source: item.genre || "movie" }]));
    return;
  }
  if (item.series_id) {
    const episodes = await fetchVodSeries(item.series_id);
    if (!episodes.length) return;
    const streams = episodes.map((ep) => ({
      url: ep.url,
      quality: null,
      source: `S${ep.season ?? "?"}E${ep.number ?? "?"} ${ep.title}`.slice(0, 48),
    }));
    openPlayer(asChannel(item, streams));
    return;
  }
  if (item.identifier) {
    const url = await fetchArchiveStream(item.identifier);
    openPlayer(asChannel(item, [{ url, quality: null, source: "Internet Archive" }]));
  }
}

function vodCard(item: VodItem): HTMLElement {
  const el = document.createElement("button");
  el.className = "vodCard";
  el.title = item.summary || item.title;
  el.innerHTML = `
    <span class="vodPoster">${item.poster ? `<img loading="lazy" alt="" src="${escapeHtml(item.poster)}">` : "🎬"}</span>
    <span class="vodTitle">${escapeHtml(item.title)}</span>
    <span class="vodMeta">${escapeHtml([item.genre, item.rating].filter(Boolean).join(" · "))}</span>`;
  el.addEventListener("click", () => {
    el.classList.add("loading");
    void playVod(item).finally(() => el.classList.remove("loading"));
  });
  return el;
}

/** Append the On Demand section to the explore page; loads async. */
export function appendVodSection(container: HTMLElement): void {
  const section = document.createElement("section");
  section.id = "vodSection";
  container.append(section);
  void fetchVod().then((rails) => {
    if (!rails.length || !section.isConnected) return;
    const head = document.createElement("div");
    head.className = "sectionHead vodHead";
    head.textContent = "On Demand — movies & shows, from the start";
    section.append(head);
    for (const rail of rails.slice(0, 14)) {
      const el = document.createElement("div");
      el.className = "rail";
      el.innerHTML = `<div class="railHead"><h2>${escapeHtml(rail.name)}</h2>
        <span class="railTag">${rail.items.length} titles</span></div>`;
      const scroller = document.createElement("div");
      scroller.className = "railScroll";
      for (const item of rail.items.slice(0, 30)) scroller.append(vodCard(item));
      el.append(scroller);
      section.append(el);
    }
  });
}
