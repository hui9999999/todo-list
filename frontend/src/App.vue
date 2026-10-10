<script setup lang="ts">
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { computed } from "vue";
import { router, navigationError, navigationPending } from "./router";
import {useDesktopBridge} from './desktop-bridge';
import {useDesktopAutoStart} from './desktop-auto-start';
import {usePetPresence} from './pet-presence';
import WebPet from './components/WebPet.vue';
import {nativeApp} from './platform';
useDesktopBridge();
usePetPresence();
useDesktopAutoStart();
const initialNavigation = computed(() => navigationPending.value && !router.currentRoute.value.matched.length);
async function retry() {
  navigationError.value = "";
  try {
    await router.replace(nativeApp ? location.hash.slice(1) || '/today' : location.pathname + location.search);
  } catch {
    navigationError.value = "页面暂时无法加载，请确认服务可用后重试。";
  }
}
</script>
<template>
  <el-config-provider :locale="zhCn"
    ><main v-if="navigationError" class="bootstrap-error">
      <h1>暂时无法打开清单</h1>
      <p role="alert">{{ navigationError }}</p>
      <el-button type="primary" @click="retry">重新加载</el-button>
    </main>
    <main v-else-if="initialNavigation" class="bootstrap-error" aria-live="polite" aria-busy="true">
      <h1>正在打开工作台</h1>
      <p>正在恢复登录会话，请稍候。</p>
    </main>
    <router-view v-else
  /><WebPet/></el-config-provider>
</template>
