import { randomUUID } from "node:crypto";
import type { LibraryItem } from "../shared/types";
import { settingsStore } from "./settingsStore";

function readAll(): LibraryItem[] {
  const raw = settingsStore.get("library") as LibraryItem[] | unknown;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x) =>
      x &&
      typeof (x as LibraryItem).id === "string" &&
      typeof (x as LibraryItem).path === "string"
  ) as LibraryItem[];
}

function writeAll(items: LibraryItem[]): void {
  settingsStore.set("library", items);
}

export function libraryList(): LibraryItem[] {
  return [...readAll()].sort((a, b) => b.addedAt - a.addedAt);
}

export function libraryAdd(pathStr: string): LibraryItem {
  const items = readAll();
  const base = pathStr.split(/[/\\]/).pop() ?? "clip";
  const item: LibraryItem = {
    id: randomUUID(),
    path: pathStr,
    title: base.replace(/\.[^.]+$/, ""),
    notes: "",
    addedAt: Date.now(),
  };
  items.push(item);
  writeAll(items);
  return item;
}

export function libraryRemove(id: string): void {
  writeAll(readAll().filter((x) => x.id !== id));
}

export function libraryUpdateMeta(
  id: string,
  patch: Partial<Pick<LibraryItem, "title" | "notes">>
): LibraryItem | null {
  const items = readAll();
  const idx = items.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  const next = { ...items[idx]!, ...patch };
  items[idx] = next;
  writeAll(items);
  return next;
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

export function librarySearch(query: string): LibraryItem[] {
  const q = query.trim();
  if (!q) return libraryList();
  const tokens = tokenize(q);
  const items = readAll();
  const scored = items.map((it) => {
    const hay = `${it.title}\n${it.notes}\n${it.path}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score += 2;
      const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      const m = hay.match(re);
      score += (m?.length ?? 0) * 0.5;
    }
    return { it, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.it.addedAt - a.it.addedAt)
    .map((x) => x.it);
}
