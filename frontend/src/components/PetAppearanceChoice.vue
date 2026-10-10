<script setup lang="ts">
import {ref} from 'vue';
import {useDesktopPet} from '../stores/desktop-pet';
import {nativeApp} from '../platform';
const desktop=useDesktopPet(),busy=ref(false),error=ref('');
async function choose(style:'2d'|'3d'){busy.value=true;error.value='';try{await desktop.chooseStyle(style);}catch{error.value='版本暂时无法切换，请重试。';}finally{busy.value=false;}}
</script>
<template>
  <div class="pet-appearance-choice">
    <div role="group" aria-label="桌宠版本"><span>版本</span><button type="button" :aria-pressed="desktop.renderStyle==='2d'" :disabled="busy" @click="choose('2d')">2D 原版</button><button type="button" :aria-pressed="desktop.renderStyle==='3d'" :disabled="busy" @click="choose('3d')">3D 立体</button></div>
    <p v-if="!desktop.available" class="field-hint">{{nativeApp?'立即应用于 App 内的小狒。':'立即应用于网页小狒；打开 Windows 桌宠时同步所选版本。'}}</p>
    <p v-if="error" role="alert">{{error}}</p>
  </div>
</template>
<style scoped>
.pet-appearance-choice{margin:16px 0}.pet-appearance-choice>div{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.pet-appearance-choice span{font-size:13px;color:var(--el-text-color-secondary);margin-right:6px}.pet-appearance-choice button{font:inherit;font-size:14px;padding:8px 15px;border:1px solid var(--el-border-color);border-radius:7px;background:var(--el-bg-color);color:var(--el-text-color-regular);cursor:pointer}.pet-appearance-choice button[aria-pressed=true]{color:var(--el-color-primary);border-color:var(--el-color-primary);background:var(--el-color-primary-light-9)}.pet-appearance-choice button:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:2px}.pet-appearance-choice button:disabled{opacity:.6;cursor:wait}
</style>
