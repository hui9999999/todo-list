<script setup lang="ts">
import type {Run} from '../advanced-types';
defineProps<{run: Run|null}>();
</script>
<template>
  <div class="ai-usage-help">
    <p>任务变更先预览、确认后执行。可以让小狒总结附件或提取待办。</p>
    <p>开启输入区的联网搜索后，小狒按问题需要检索公开网页，回答附来源链接。免费搜索无需密钥，结果质量和可用性有限；回答基于搜索摘要。对话模型处理搜索结果仍使用现有模型额度。</p>
    <p>也可以查询自己的账号、隐藏任务、垃圾站、日历、周期、专注、历史与记忆，以及资讯和模型配置；密码、API 密钥和登录凭据不可读。</p>
    <p>试试“查一下垃圾站里的任务”“导出本周周报”“导出上月月报为 Word”或“导出我的全部账号资料”。任务和报告支持 Excel、PDF、Word、CSV；完整账号资料使用 JSON。文件会显示在对话里，手机可保存或分享。</p>
    <p>支持 Word（DOCX）、PDF、MD、JSON、TXT、CSV、图片，也可以拖入文件和粘贴截图。</p>
    <p>每条消息最多 5 个附件，单个最多 8 MB，合计最多 20 MB。图片和扫描 PDF 会提取文字；识别画面需在设置中验证识图模型。旧版 DOC 请先转为 DOCX。</p>
    <p>文档过长会截取部分内容并提示读取范围。每次使用最近最多 20 条消息；更早的用户输入从最近 80 条中提取带来源的节选。长对话请补充重要条件。</p>
    <p v-if="run">{{ run.actual_mode || '等待模型' }} · {{ run.mode_reason }}</p>
  </div>
</template>
