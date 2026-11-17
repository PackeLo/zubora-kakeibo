import { ref } from "vue";
import type { Router } from "vue-router";

// 編集中（保存処理中）の遷移ガード用フラグ。EntryEditor の busy を App 経由で共有する。
export const entryEditorBusy = ref(false);

export interface NavEntry {
  fullPath: string;
  name: string | null;
}

interface NavTracker {
  stack: NavEntry[];
  index: number;
}

const trackers = new WeakMap<Router, NavTracker>();

// アプリ内履歴スタックを router ごとに記録する（window.history.length はアプリ外も含むため使わない）。
export function initNavTracker(router: Router): NavTracker {
  const existing = trackers.get(router);
  if (existing) return existing;
  const tracker: NavTracker = { stack: [], index: -1 };
  trackers.set(router, tracker);
  router.afterEach((to) => {
    const entry: NavEntry = { fullPath: to.fullPath, name: typeof to.name === "string" ? to.name : null };
    if (tracker.index < 0 || tracker.stack.length === 0) {
      tracker.stack = [entry];
      tracker.index = 0;
      return;
    }
    if (tracker.stack[tracker.index]?.fullPath === entry.fullPath) {
      tracker.stack[tracker.index] = entry;
      return;
    }
    for (let i = tracker.index - 1; i >= 0; i -= 1) {
      if (tracker.stack[i].fullPath === entry.fullPath) {
        tracker.index = i;
        return;
      }
    }
    for (let i = tracker.index + 1; i < tracker.stack.length; i += 1) {
      if (tracker.stack[i].fullPath === entry.fullPath) {
        tracker.index = i;
        return;
      }
    }
    const historyState = (router.options.history as { state?: { replaced?: boolean } }).state;
    const replaced = historyState?.replaced ?? (typeof window !== "undefined" ? window.history.state?.replaced : undefined);
    if (replaced) {
      tracker.stack[tracker.index] = entry;
      return;
    }
    tracker.stack.splice(tracker.index + 1);
    tracker.stack.push(entry);
    tracker.index += 1;
  });
  return tracker;
}

export function getNavTracker(router: Router): NavTracker | undefined {
  return trackers.get(router);
}

// アプリ内で1つ前の画面があるか（直接着地時は false）。
export function hasInAppPrevious(router: Router): boolean {
  const tracker = trackers.get(router);
  return !!tracker && tracker.index > 0;
}

export function previousNavEntry(router: Router): NavEntry | null {
  const tracker = trackers.get(router);
  if (!tracker || tracker.index <= 0) return null;
  return tracker.stack[tracker.index - 1] ?? null;
}
