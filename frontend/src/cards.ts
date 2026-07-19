import { toggleFavorite } from "./api";
import { watchCard } from "./health";
import { openPlayer } from "./player";
import { chMeta, isDead, state } from "./state";
import type { Channel } from "./types";
import { escapeHtml } from "./util";

export function card(ch: Channel): HTMLElement {
  const el = document.createElement("div");
  el.className = "card";
  el.dataset.id = ch.id;
  const health = ch.streams[0] ? state.health.get(ch.streams[0].url) : undefined;
  if (isDead(ch)) el.classList.add("dead");

  el.innerHTML = `
    <div class="dot ${health === true ? "alive" : health === false ? "dead" : ""}"></div>
    <button class="star ${state.favorites.has(ch.id) ? "on" : ""}" title="Favorite">★</button>
    <div class="logoBox"></div>
    <div class="cname">${escapeHtml(ch.name)}</div>
    <div class="cmeta">${escapeHtml(chMeta(ch))}</div>`;
  setLogo(el.querySelector<HTMLElement>(".logoBox")!, ch);

  el.querySelector(".star")!.addEventListener("click", async (e) => {
    e.stopPropagation();
    const on = await toggleFavorite(ch);
    (e.target as HTMLElement).classList.toggle("on", on);
  });
  el.addEventListener("click", () => openPlayer(ch));
  watchCard(el);
  return el;
}

// Try each logo url directly, then through the /logo proxy (dodges
// hotlink blocking), before giving up on the 📺 placeholder.
export function setLogo(box: HTMLElement, ch: Channel): void {
  const candidates = (ch.logos || []).flatMap((u) => [u, `/logo?url=${encodeURIComponent(u)}`]);
  if (!candidates.length) {
    box.innerHTML = '<div class="noLogo">📺</div>';
    return;
  }
  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = "";
  let i = 0;
  img.onerror = () => {
    i++;
    const next = candidates[i];
    if (next) img.src = next;
    else box.innerHTML = '<div class="noLogo">📺</div>';
  };
  img.src = candidates[0]!;
  box.append(img);
}
