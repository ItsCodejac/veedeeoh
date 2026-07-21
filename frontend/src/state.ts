import type { Region, Filters } from "./types";
import { $ } from "./util";

export const state = {
  region: { code: null, source: "unknown" } as Region,
  favorites: new Set<string>(),
  watched: new Set<string>(),
  health: new Map<string, boolean>(),
  rendered: 0
};

export function filters(): Filters {
  return {
    q: $<HTMLInputElement>("search")?.value.trim().toLowerCase() || "",
    country: "",
    category: "",
    favorites: false,
    hideDead: false,
  };
}
