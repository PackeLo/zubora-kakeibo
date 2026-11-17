import { createRouter, createWebHistory, type Router, type RouterHistory } from "vue-router";
import { entryEditorBusy, initNavTracker } from "./navigation";

// 全ルートで同じ App シェルを表示する（画面状態は route から導出する）。
const AppShell = () => import("./App.vue");

export function createAppRouter(history: RouterHistory = createWebHistory()): Router {
  const router = createRouter({
    history,
    routes: [
      { path: "/", redirect: "/dashboard" },
      { path: "/dashboard", name: "dashboard", component: AppShell },
      { path: "/dashboard/category/:categoryId", name: "dashboard-category", component: AppShell },
      { path: "/dashboard/day/:date", name: "dashboard-day", component: AppShell },
      { path: "/entries", name: "entries", component: AppShell },
      { path: "/entries/:id", name: "entry-details", component: AppShell },
      { path: "/entries/:id/edit", name: "entry-edit", component: AppShell },
      { path: "/receipts", name: "receipts", component: AppShell },
      { path: "/source-items", name: "source-items", component: AppShell },
      { path: "/duplicates", name: "duplicates", component: AppShell },
      { path: "/assets", name: "assets", component: AppShell },
      { path: "/taxonomy", name: "taxonomy", component: AppShell },
      { path: "/archives", name: "archives", component: AppShell },
      { path: "/:pathMatch(.*)*", name: "not-found", component: AppShell }
    ],
    // 戻る時は元のスクロール位置を復元し、進む時は先頭へ。
    scrollBehavior(_to, _from, savedPosition) {
      return savedPosition ?? { top: 0 };
    }
  });
  initNavTracker(router);
  // 保存処理中は遷移を止める（従来のタブ無効化と同じガード。未保存確認は対象外）。
  router.beforeEach(() => {
    if (entryEditorBusy.value) return false;
    return true;
  });
  return router;
}
