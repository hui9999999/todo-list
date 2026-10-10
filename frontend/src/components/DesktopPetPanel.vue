<script setup lang="ts">
import {computed,onMounted,ref} from 'vue';
import {pageVisible} from '../pet-presence';
import {useRouter} from 'vue-router';
import {useDesktopPet} from '../stores/desktop-pet';
import DesktopPetSettings from './DesktopPetSettings.vue';
import PetSprite from './PetSprite.vue';
import PetAppearanceChoice from './PetAppearanceChoice.vue';
import {nativeApp} from '../platform';
const desktop=useDesktopPet(),router=useRouter(),selected=ref(0),error=ref('');
const inDesktop=computed(()=>desktop.available?Boolean(desktop.settings?.visible):desktop.nativeActive);
const previewVisible=computed(()=>pageVisible.value&&!desktop.launching&&(desktop.available?!inDesktop.value:desktop.presenceReady&&!inDesktop.value));
const actions=[{label:'陪伴',index:0},{label:'漫步',index:1},{label:'学习',index:4},{label:'工作',index:5},{label:'思考',index:6},{label:'庆祝',index:7},{label:'拖动',index:8},{label:'落地',index:9},{label:'伸懒腰',index:10},{label:'打哈欠',index:11},{label:'喝水',index:12},{label:'睡觉',index:13},{label:'招手',index:14},{label:'撑伞',index:15}];
const pose=computed(()=>actions[selected.value]!);
const kind=computed(()=>({0:'idle',1:'walking',4:'focus',5:'focus',6:'think',7:'celebrate',8:'dragged',9:'landing',10:'stretch',11:'yawn',12:'rest',13:'sleep',14:'remind',15:'umbrella'}[pose.value.index]||'idle'));
async function showPet(){error.value='';try{await desktop.update({visible:true});}catch{error.value='暂时无法显示小狒，请重试。';}}
async function chat(){await showPet();if(!error.value)await router.push('/ai');}
async function launch(){error.value='';try{await desktop.launch('chat');}catch(e){error.value=(e as Error).message;}}
onMounted(()=>{if(desktop.available)void desktop.load().catch(()=>{error.value='桌宠设置暂时无法读取。';});});
</script>
<template>
  <section class="pet-companion-page" aria-label="小狒桌宠中心">
    <div class="pet-companion-intro">
      <div class="pet-companion-stage"><template v-if="previewVisible"><PetSprite :index="pose.index" :kind="kind" :label="pose.label" :render-style="desktop.renderStyle" fallback-to2d/><span class="pet-preview-caption">{{pose.label}}</span></template><p v-else>{{inDesktop?'小狒正在桌面陪伴你':desktop.launching?'正在切换到桌面版…':'正在连接小狒…'}}</p></div>
      <div class="pet-companion-copy"><p class="pet-companion-kicker">你的桌面伙伴</p><h2>小狒，陪你把事情做好。</h2><p>专注时一起努力，完成后一起庆祝。点点小狒，就能聊天安排任务。</p>
        <PetAppearanceChoice/>
        <div v-if="desktop.available" class="pet-companion-actions"><el-button type="primary" @click="showPet">显示桌宠</el-button><el-button @click="chat">和小狒聊天</el-button></div>
        <div v-else class="pet-companion-actions"><a v-if="!nativeApp" class="pet-launch-primary" :href="desktop.launchUrl('chat')" @click.prevent="launch">打开 Windows 桌宠 ↗</a><router-link to="/ai" class="pet-chat-link">{{nativeApp?'和小狒聊天':'在工作台聊天'}}</router-link></div>
        <p class="pet-companion-note">{{nativeApp?'小狒在 App 内陪伴你。点击聊天，拖动移动；登录后自动显示。':desktop.available?'右键小狒可隐藏或退出；关闭聊天窗口后仍会陪伴。':'打开工作台即可使用网页小狒，无需安装。已安装桌面版时可点击上方按钮，允许启动并确认账号绑定；网页与桌面版会自动切换，只显示一只。首次安装请先运行「启动小狒.cmd」。'}}</p>
        <p v-if="error" role="alert">{{error}}</p>
      </div>
    </div>
    <div class="pet-pose-selector" role="group" aria-label="小狒动作预览"><button v-for="(action,index) in actions" :key="action.label" type="button" :aria-pressed="selected===index" @click="selected=index">{{action.label}}</button></div>
    <div class="pet-companion-features"><article><span>01</span><h3>桌面陪伴</h3><p>自由拖动，记住位置；闲时漫步，也可以安静待着。</p></article><article><span>02</span><h3>专注与庆祝</h3><p>显示本轮倒计时，按任务切换读书或工作动作，完成后欢呼。</p></article><article><span>03</span><h3>聊天管理任务</h3><p>用一句话创建、修改或删除任务，核对预览后确认执行。</p></article></div>
    <DesktopPetSettings v-if="desktop.available" :show-appearance="false"/>
  </section>
</template>
<style scoped>
.pet-companion-page{max-width:1100px;--panel:var(--el-bg-color);--primary:var(--el-color-primary);--muted:var(--el-text-color-secondary);--border:var(--el-border-color);--primary-contrast:var(--workbench-button-text)}.pet-companion-intro{display:grid;grid-template-columns:minmax(240px,.85fr) minmax(300px,1.2fr);align-items:center;gap:48px;padding:12px 0 28px}.pet-companion-stage{display:flex;align-items:center;flex-direction:column;justify-content:center;min-height:310px;background:var(--panel);border-radius:24px}.pet-preview-caption{font-size:12px;color:var(--muted);padding:5px 18px;border:1px solid var(--border);border-radius:20px;margin:0 0 20px}.pet-companion-kicker{font-size:12px;letter-spacing:2px;color:var(--primary);margin:0 0 14px}.pet-companion-copy h2{font-size:clamp(24px,2.3vw,36px);line-height:1.4;margin:0 0 20px}.pet-companion-copy>p:not(.pet-companion-kicker){line-height:1.8;color:var(--muted);max-width:430px}.pet-companion-actions{display:flex;align-items:center;flex-wrap:wrap;gap:18px;margin:26px 0 16px}.pet-launch-primary{display:inline-flex;align-items:center;padding:12px 18px;border-radius:8px;background:var(--primary);color:var(--primary-contrast,#fff);text-decoration:none;font-size:14px}.pet-chat-link{font-size:14px;color:var(--muted)}.pet-companion-copy .pet-companion-note{font-size:12px}.pet-pose-selector{display:flex;flex-wrap:wrap;gap:8px;padding:18px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}.pet-pose-selector button{font:inherit;font-size:13px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--muted);padding:7px 13px;cursor:pointer}.pet-pose-selector button[aria-pressed=true]{background:var(--panel);border-color:var(--border);color:var(--primary)}.pet-pose-selector button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}.pet-companion-features{display:grid;grid-template-columns:repeat(3,1fr);gap:36px;padding:32px 0}.pet-companion-features article>span{font-size:12px;color:var(--muted)}.pet-companion-features h3{font-size:16px;margin:12px 0}.pet-companion-features p{color:var(--muted);font-size:13px;line-height:1.8;margin:0}@media(max-width:1000px){.pet-companion-intro{grid-template-columns:1fr;gap:26px}.pet-companion-stage{min-height:270px}.pet-companion-copy h2{font-size:26px}.pet-companion-features{gap:20px}}@media(max-width:600px){.pet-companion-features{grid-template-columns:1fr;gap:26px}.pet-companion-intro{padding-top:0}}
</style>

