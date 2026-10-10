import { computed, onUnmounted, ref } from 'vue';
import {createUuid} from './uuid';

export const attachmentAccept = '.docx,.pdf,.md,.markdown,.json,.txt,.csv,.png,.jpg,.jpeg,.webp';
const supported = new Set(attachmentAccept.split(',').map(extension => extension.slice(1)));
interface DraftAttachment {id: string; name: string; size: number; data: string; preview?: string}
export function fileSize(bytes: number) {return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;}
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1]!);
    reader.onerror = () => reject(new Error(`「${file.name}」读取失败，请重新选择`));
    reader.onabort = () => reject(new Error('文件读取已取消'));
    reader.readAsDataURL(file);
  });
}
export function useChatAttachments(blocked: () => boolean) {
  const files = ref<DraftAttachment[]>([]), reading = ref(false), error = ref('');
  let generation = 0;
  const totalSize = computed(() => files.value.reduce((sum, file) => sum + file.size, 0));
  function clear() {
    generation++;
    files.value.forEach(file => {if (file.preview) URL.revokeObjectURL(file.preview);});
    files.value = []; error.value = '';
  }
  function remove(id: string) {
    const file = files.value.find(file => file.id === id);
    if (file?.preview) URL.revokeObjectURL(file.preview);
    files.value = files.value.filter(file => file.id !== id); error.value = '';
  }
  async function add(incoming: File[]) {
    if (!incoming.length || blocked() || reading.value) return;
    error.value = '';
    if (files.value.length + incoming.length > 5) {error.value = '每条消息最多添加 5 个附件'; return;}
    if (incoming.some(file => !supported.has(file.name.split('.').at(-1)?.toLowerCase() || ''))) {error.value = '支持 DOCX、PDF、MD、JSON、TXT、CSV 和 PNG/JPG/WEBP 图片；旧版 DOC 请先转换为 DOCX'; return;}
    if (incoming.some(file => file.size === 0)) {error.value = '附件为空，请选择有内容的文件'; return;}
    if (incoming.some(file => file.size > 8 * 1024 * 1024) || totalSize.value + incoming.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) {error.value = '单个附件最多 8 MB，每条消息附件合计最多 20 MB'; return;}
    if (incoming.some(file => file.name.length > 200)) {error.value = '附件名称过长，请缩短到 200 个字符以内'; return;}
    reading.value = true;
    const current = generation;
    try {
      const data = await Promise.all(incoming.map(readFile));
      if (current !== generation) return;
      files.value.push(...incoming.map((file, index) => ({id: createUuid(), name: file.name, size: file.size, data: data[index]!, preview: /\.(png|jpe?g|webp)$/i.test(file.name) ? URL.createObjectURL(file) : undefined})));
    } catch (e) {if (current === generation) error.value = (e as Error).message;}
    finally {reading.value = false;}
  }
  function paste(event: ClipboardEvent) {
    const incoming = Array.from(event.clipboardData?.files || []);
    if (incoming.length) {event.preventDefault(); void add(incoming);}
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    void add(Array.from(event.dataTransfer?.files || []));
  }
  onUnmounted(clear);
  return {files, reading, error, totalSize, clear, remove, add, paste, drop};
}
