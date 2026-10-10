import { onMounted, onUnmounted, readonly, ref } from 'vue';

const now = ref(Date.now());
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | undefined;

// All visible task cards share one timer, released when the list is unmounted.
export function useTaskClock() {
  onMounted(() => {
    if (subscribers++ === 0) {
      now.value = Date.now();
      timer = setInterval(() => { now.value = Date.now(); }, 1000);
    }
  });
  onUnmounted(() => {
    if (--subscribers === 0) { clearInterval(timer); timer = undefined; }
  });
  return readonly(now);
}
