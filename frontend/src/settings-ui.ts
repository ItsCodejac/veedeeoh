// Shared presentation helpers for the Settings sections. Extracted so the
// section modules agree on markup without importing each other.

import { escapeHtml } from "./util";

export const card = (title: string, body: string, hint = ""): string => `
  <section class="setCard">
    <h2>${escapeHtml(title)}</h2>
    ${hint ? `<p class="setHint">${hint}</p>` : ""}
    ${body}
  </section>`;

export const row = (label: string, value: string): string => `
  <div class="setRow">
    <span class="setRowLabel">${escapeHtml(label)}</span>
    <span class="setRowValue">${value}</span>
  </div>`;

export const fmtDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "—";
