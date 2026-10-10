<script setup lang="ts">
import {computed, ref, onUnmounted} from 'vue';
import {Check, ArrowDown} from '@element-plus/icons-vue';
import {api} from '../api';
import {useAuth} from '../stores/auth';
import type {Settings} from '../advanced-types';
import {themeOptions,themeOption,renderTheme,rememberTheme,settingKeys} from '../themes';

const emit=defineEmits<{saved:[settings:Settings]}>();
const auth=useAuth();
const open=ref(false),busy=ref(false),error=ref(''),chosen=ref('light');
let original='light',applied=false;
const current=computed(()=>themeOption(chosen.value));
const groups=[{id:'dark',title:'夜间模式'},{id:'warm',title:'暖色模式'}];
function show() {
  original=document.documentElement.dataset.palette || 'light';chosen.value=original;
  applied=false;error.value='';open.value=true;
}
function preview(id:string) {if(busy.value)return;chosen.value=id;renderTheme(id);}
function cancel() {
  if(!applied)renderTheme(original);
  open.value=false;
}
async function save() {
  if(busy.value)return;
  busy.value=true;error.value='';
  try {
    if(auth.user) {
      const latest=await api<Settings>('/settings');
      const body={...Object.fromEntries(settingKeys.map(key=>[key,latest[key]])),theme:current.value.family};
      const result=await api<Settings>('/settings',{method:'PUT',body:JSON.stringify(body)});
      rememberTheme(chosen.value);emit('saved',result);
    } else rememberTheme(chosen.value);
    applied=true;open.value=false;
  } catch(e) {error.value=(e as Error).message;}
  finally {busy.value=false;}
}
function beforeClose(done:()=>void) {if(busy.value)return;cancel();done();}
onUnmounted(()=>{if(open.value && !applied)renderTheme(original);});
</script>
<template>
  <button type="button" class="brand workspace-brand" aria-label="个人工作台，切换主题" aria-haspopup="dialog" :aria-expanded="open" @click="show"><span class="brand-mark" aria-hidden="true"><el-icon><Check/></el-icon></span><span class="workspace-brand-text">个人工作台</span><el-icon class="workspace-brand-chevron" aria-hidden="true"><ArrowDown/></el-icon></button>
  <el-dialog v-model="open" class="theme-dialog" title="选择主题" width="900px" align-center append-to-body :close-on-click-modal="!busy" :close-on-press-escape="!busy" :before-close="beforeClose" @close="cancel">
    <p class="theme-dialog-description">点击方案预览当前页面，应用后会记住选择。</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" class="theme-error"/>
    <section v-for="group in groups" :key="group.id" class="theme-group" :aria-label="group.title">
      <h2>{{group.title}}</h2>
      <div class="theme-options">
        <button v-for="option in themeOptions.filter(option=>option.family === group.id)" :key="option.id" type="button" class="theme-option" :class="{selected:chosen === option.id}" :aria-pressed="chosen === option.id" :aria-label="'预览'+option.name" :disabled="busy" @click="preview(option.id)">
          <div class="theme-mini" aria-hidden="true" :style="{'--mini-bg':option.bg,'--mini-surface':option.surface,'--mini-sidebar':option.sidebar,'--mini-text':option.text,'--mini-secondary':option.secondary,'--mini-border':option.border,'--mini-accent':option.accent}">
            <div class="theme-mini-sidebar"><i/><i class="selected"/><i/><i/></div>
            <div class="theme-mini-main"><div class="theme-mini-heading"><strong>今日任务</strong><span>＋</span></div><div class="theme-mini-task"><i/><span>整理项目计划</span><small>02:30</small></div><div class="theme-mini-task"><i/><span>复习学习笔记</span><small>05:00</small></div><div class="theme-mini-bars"><i/><i/><i/><i/><i/></div></div>
          </div>
          <div class="theme-option-heading"><strong>{{option.name}}</strong><el-icon v-if="chosen === option.id"><Check/></el-icon></div><p>{{option.description}}</p>
        </button>
      </div>
    </section>
    <template #footer><div class="theme-dialog-footer"><el-button text :disabled="busy" @click="preview('light')">恢复清爽浅色</el-button><span>当前预览：{{current.name}}</span><div><el-button :disabled="busy" @click="cancel">取消</el-button><el-button type="primary" :loading="busy" @click="save">应用主题</el-button></div></div></template>
  </el-dialog>
</template>
