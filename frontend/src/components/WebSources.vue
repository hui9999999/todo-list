<script setup lang="ts">
import {computed} from 'vue';
import type {WebSource} from '../advanced-types';
const props=defineProps<{sources:WebSource[]}>();
const visible=computed(()=>props.sources.filter(source=>{
  try{const url=new URL(source.url);return ['https:','http:'].includes(url.protocol) && !url.username && !url.password;}
  catch{return false;}
}));
const weatherOnly=computed(()=>visible.value.length>0&&visible.value.every(source=>source.kind==='weather'));
</script>
<template>
  <section v-if="visible.length" class="ai-web-sources" :aria-label="weatherOnly?'天气来源':'网页来源'">
    <small>{{weatherOnly?'天气来源 · 当前实况':'网页来源 · 基于搜索摘要'}}</small>
    <ol><li v-for="source in visible" :key="source.index" :value="source.index"><a :href="source.url" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"><span>{{source.title}}</span><small>{{source.site}}<template v-if="source.published_at"> · {{source.published_at.slice(0,10)}}</template></small></a></li></ol>
  </section>
</template>
