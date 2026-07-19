import { checkStream } from "./api";
import { isDead, state } from "./state";
import type { Channel } from "./types";

// Lazy health checks: probe streams as their cards scroll into view.
const queue: Array<[Channel, HTMLElement]> = [];
let inFlight = 0;

const observer = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    observer.unobserve(e.target);
    const id = (e.target as HTMLElement).dataset.id;
    const ch = state.channels.find((c) => c.id === id);
    if (ch && ch.streams[0] && !state.health.has(ch.streams[0].url)) {
      queue.push([ch, e.target as HTMLElement]);
      pump();
    }
  }
});

export function watchCard(el: HTMLElement): void {
  observer.observe(el);
}

function pump(): void {
  while (inFlight < 3 && queue.length) {
    const [ch, el] = queue.shift()!;
    const url = ch.streams[0]!.url;
    inFlight++;
    checkStream(url)
      .then((v) => {
        state.health.set(url, v.ok);
        el.querySelector(".dot")?.classList.add(v.ok ? "alive" : "dead");
        if (isDead(ch)) el.classList.add("dead");
      })
      .catch(() => {})
      .finally(() => {
        inFlight--;
        pump();
      });
  }
}
