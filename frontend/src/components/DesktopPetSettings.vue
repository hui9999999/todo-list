<script setup lang="ts">
import {ref} from 'vue';
import {useDesktopPet} from '../stores/desktop-pet';
import type {DesktopPetSettings} from '../desktop-types';
import PetAppearanceChoice from './PetAppearanceChoice.vue';
import {nativeApp} from '../platform';
withDefaults(defineProps<{showAppearance?:boolean}>(),{showAppearance:true});
const desktop=useDesktopPet(),busy=ref(false),error=ref('');
async function update(patch:Partial<DesktopPetSettings>){busy.value=true;error.value='';try{await desktop.update(patch);}catch{error.value='桌宠设置暂时无法保存，请重试。';}finally{busy.value=false;}}
async function launch(){busy.value=true;error.value='';try{await desktop.launch('settings');}catch(e){error.value=(e as Error).message;}finally{busy.value=false;}}
</script>
<template>
  <section class="settings-group desktop-pet-settings" aria-label="小狒桌宠设置">
    <h3>小狒桌宠</h3>
    <PetAppearanceChoice v-if="showAppearance"/>
    <template v-if="desktop.available && desktop.settings">
      <div class="switch-list">
        <el-checkbox :model-value="desktop.settings.visible" :disabled="busy" @change="value=>update({visible:Boolean(value)})">显示小狒</el-checkbox>
        <el-checkbox :model-value="desktop.settings.alwaysOnTop" :disabled="busy" @change="value=>update({alwaysOnTop:Boolean(value)})">始终置顶</el-checkbox>
        <el-checkbox :model-value="desktop.settings.motion" :disabled="busy" @change="value=>update({motion:Boolean(value)})">动作动画</el-checkbox>
        <el-checkbox :model-value="desktop.settings.wander" :disabled="busy || !desktop.settings.motion" @change="value=>update({wander:Boolean(value)})">闲时漫步</el-checkbox>
      </div>
      <div class="action-row"><label>大小 <el-select :model-value="desktop.settings.size" aria-label="桌宠大小" :disabled="busy" @change="value=>update({size:value})"><el-option label="小" :value="120"/><el-option label="标准" :value="160"/><el-option label="大" :value="200"/></el-select></label><el-button text :disabled="busy" @click="update({position:null})">重置位置</el-button></div>
      <p class="field-hint">点击聊天，拖动移动。关闭聊天窗口后，小狒继续在桌面陪伴。</p>
    </template>
    <template v-else-if="!desktop.available">
      <el-checkbox :model-value="desktop.webEnabled" @change="value=>desktop.setWebEnabled(Boolean(value))">{{nativeApp?'在 App 内显示小狒':'在网页显示小狒'}}</el-checkbox>
      <p class="field-hint">{{nativeApp?'登录后即可陪伴。点击聊天，拖动移动。':'无需安装，登录工作台即可陪伴。点击聊天，拖动移动；桌面版运行时，网页小狒自动隐藏，退出后恢复。'}}</p>
      <template v-if="!nativeApp"><el-checkbox v-if="desktop.supportsAutoStart" :model-value="desktop.autoStart" @change="value=>desktop.setAutoStart(Boolean(value))">打开网页时自动启动桌宠</el-checkbox><p class="field-hint">已安装 Windows 桌面版后可开启自动启动。首次需允许浏览器打开小狒，并确认账号绑定；之后网页切换账号或退出，桌宠自动跟随。</p><a class="desktop-pet-launch" :href="desktop.launchUrl('settings')" @click.prevent="launch">打开桌宠设置 ↗</a></template>
    </template>
    <p v-else class="field-hint">正在读取桌宠设置…</p>
    <p v-if="error" role="alert" class="nickname-error">{{error}}</p>
  </section>
</template>
