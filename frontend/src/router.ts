import { createRouter, createWebHistory, createWebHashHistory } from "vue-router";
import { nativeApp } from './platform';
import { useAuth } from "./stores/auth";
import { ref } from "vue";
export const navigationError = ref("");
export const navigationPending = ref(true);
export const router = createRouter({
  history: nativeApp ? createWebHashHistory() : createWebHistory(),
  routes: [
    { path: "/auth", component: () => import("./views/AuthView.vue") },
    { path: "/trash", redirect: "/data?tab=trash" },
    { path: "/settings", redirect: "/account" },
    { path: "/history", redirect: to => ({path: '/account', query: {...to.query, tab: 'history'}}) },
    {
      path: "/:view(today|tasks|ai|news|calendar|stats|focus|recurrences|pet|data|food|account|admin)?",
      component: () => import("./views/WorkspaceView.vue"),
      meta: { requiresAuth: true },
    },
    { path: "/:pathMatch(.*)*", redirect: "/today" },
  ],
});
router.beforeEach(async (to) => {
  navigationPending.value = true;
  if(to.params.view === 'ai' && to.query.tab === 'history') return {path:'/account',query:{...to.query,tab:'history'}};
  const auth = useAuth();
  if (!auth.ready) await auth.restore();
  if (to.meta.requiresAuth && !auth.user) return "/auth";
  if (to.params.view === 'admin' && !auth.user?.is_admin) return '/today';
  if (to.path === "/auth" && auth.user && !to.query.token) return "/today";
});
router.onError(() => {
  navigationPending.value = false;
  navigationError.value = "页面暂时无法加载，请确认服务可用后重试。";
});
router.afterEach((_to, _from, failure) => {
  navigationPending.value = false;
  if (!failure) navigationError.value = "";
});
