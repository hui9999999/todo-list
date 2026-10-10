import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api, post, setCsrf, ApiError } from "../api";
import type { User } from "../types";
import {forgetAssistantSession} from '../assistant-session';
export const useAuth = defineStore("auth", () => {
  const user = ref<User | null>(null);
  const ready = ref(false);
  const identifier = computed(() => user.value?.identifier || user.value?.email || user.value?.phone || '');
  const displayName = computed(() => user.value?.nickname || identifier.value);
  const avatarLetter = computed(() => (Array.from(displayName.value)[0] || '').toUpperCase());
  function accept(session: { user: User; csrf_token: string }) {
    user.value = session.user;
    setCsrf(session.csrf_token);
    ready.value = true;
  }
  async function restore() {
    try {
      const session = await api<{ user: User; csrf_token: string }>("/me", {
        signal: AbortSignal.timeout(8000),
      });
      user.value = session.user;
      setCsrf(session.csrf_token);
      ready.value = true;
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
      user.value = null;
      setCsrf("");
      ready.value = true;
    }
  }
  async function login(identifier: string, password: string) {
    const session = await post<{ user: User; csrf_token: string }>(
      "/auth/login",
      { identifier, password },
    );
    accept(session);
  }
  async function register(identifier: string, password: string, timezone: string, nickname = '') {
    accept(await post<{ user: User; csrf_token: string }>("/auth/register", { identifier, password, timezone, nickname: nickname.trim() || null }));
  }
  async function logout() {
    await window.xiaoqiDesktop?.disconnectAccountSync?.();
    await post("/auth/logout");
    forgetAssistantSession(user.value?.id||'');
    user.value = null;
    setCsrf("");
  }
  return { user, identifier, displayName, avatarLetter, ready, restore, login, register, logout };
});
