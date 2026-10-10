<script setup lang="ts">
import ThemePicker from '../components/ThemePicker.vue';
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowRight } from "@element-plus/icons-vue";
import { post } from "../api";
import { useAuth } from "../stores/auth";
const route = useRoute(),
  router = useRouter(),
  auth = useAuth();
const mode = ref(String(route.query.mode || "login"));
const token = ref(String(route.query.token || ""));
const identifier = ref(""),
  nickname = ref(""),
  password = ref(""),
  confirmation = ref("");
const registrationKind = ref<'phone' | 'email'>('phone');
const fieldErrors = reactive({ identifier: '', password: '', confirmation: '' });
const confirmationTouched = ref(false);
const identifierField = ref<{ focus: () => void } | null>(null), passwordField = ref<{ focus: () => void } | null>(null), confirmationField = ref<{ focus: () => void } | null>(null);
const identifierLabel = computed(() => mode.value === 'register' ? registrationKind.value === 'phone' ? '手机号码' : '邮箱' : mode.value === 'forgot' ? '邮箱' : '邮箱或电话号码');
const identifierType = computed(() => mode.value === 'forgot' || (mode.value === 'register' && registrationKind.value === 'email') ? 'email' : mode.value === 'register' ? 'tel' : 'text');
const identifierPlaceholder = computed(() => mode.value === 'register' ? registrationKind.value === 'phone' ? '输入手机号，国际号码可带区号' : '输入邮箱地址' : mode.value === 'forgot' ? 'you@example.com' : '邮箱、手机号或管理员账号');
const busy = ref(false),
  error = ref(""),
  message = ref("");
const title = computed(
  () =>
    ({
      login: "回来，把一天理清。",
      register: "创建你的账户",
      forgot: "重新设置密码",
      reset: "设置一个新密码",
    })[mode.value] || "登录你的清单",
);
function detectedTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'; }
  catch { return 'Asia/Shanghai'; }
}
function clearFieldErrors() {
  fieldErrors.identifier = ''; fieldErrors.password = ''; fieldErrors.confirmation = '';
}
function chooseRegistration(kind: 'phone' | 'email') {
  if (kind === registrationKind.value) return;
  registrationKind.value = kind; identifier.value = ''; fieldErrors.identifier = ''; error.value = '';
}
function checkConfirmation() {
  if (!confirmationTouched.value) return;
  fieldErrors.confirmation = !confirmation.value ? '请再次输入密码' : confirmation.value !== password.value ? '两次输入的密码不一致' : '';
}
function checkRegistration() {
  clearFieldErrors();
  const account = identifier.value.trim();
  const phone = account.replace(/[\s()（）-]/g, '').replace(/^00/, '+');
  if (!account) fieldErrors.identifier = registrationKind.value === 'phone' ? '请输入手机号码' : '请输入邮箱';
  else if (registrationKind.value === 'phone' ? !/^\+?[0-9]{7,15}$/.test(phone) : !/^[^\s@\x00-\x1f\x7f<>()\[\],;:"\\]+@[\p{L}\p{N}_.-]+$/u.test(account)) {
    fieldErrors.identifier = registrationKind.value === 'phone' ? '请输入有效的电话号码，国际号码可使用 +国家区号' : '请输入有效的邮箱地址';
  }
  if (password.value.length < 10) fieldErrors.password = '密码至少需要 10 个字符';
  confirmationTouched.value = true; checkConfirmation();
  const invalid = fieldErrors.identifier ? identifierField : fieldErrors.password ? passwordField : fieldErrors.confirmation ? confirmationField : null;
  invalid?.value?.focus();
  return !invalid;
}
async function submit() {
  if (busy.value) return;
  error.value = "";
  message.value = "";
  if (mode.value === 'register' && !checkRegistration()) return;
  busy.value = true;
  try {
    if (mode.value === "login") {
      await auth.login(identifier.value, password.value);
      password.value = "";
      await router.replace(auth.user?.is_admin ? '/admin' : '/today');
    } else if (mode.value === "register") {
      await auth.register(identifier.value, password.value, detectedTimezone(), nickname.value);
      password.value = ""; confirmation.value = ""; nickname.value = "";
      await router.replace("/today");
    } else if (mode.value === "forgot") {
      message.value = (
        await post<{ message: string }>("/auth/password-reset", {
          email: identifier.value,
        })
      ).message;
    } else if (mode.value === "reset") {
      message.value = (
        await post<{ message: string }>("/auth/password-reset/confirm", {
          token: token.value,
          password: password.value,
        })
      ).message;
      token.value = "";
      password.value = "";
      mode.value = "login";
      await router.replace("/auth");
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function switchMode(next: string) {
  if (next === 'register') registrationKind.value = identifier.value.includes('@') ? 'email' : 'phone';
  mode.value = next;
  password.value = "";
  confirmation.value = ''; confirmationTouched.value = false; clearFieldErrors();
  error.value = "";
  message.value = "";
}
onMounted(async () => {
  if (mode.value !== "verify") return;
  message.value = '注册无需邮箱验证，请直接登录';
  token.value = "";
  mode.value = "login";
  await router.replace("/auth");
});
</script>
<template>
  <main class="auth-layout">
    <section class="auth-story">
      <ThemePicker/>
      <div>
        <p class="eyebrow">WORK & LIFE, IN ORDER</p>
        <h1>事情很多。<br />一件一件来。</h1>
        <p class="story-copy">
          让工作的进度、生活的琐事，<br />都有一个安稳的落点。
        </p>
      </div>
      <p class="auth-footnote">你的独立清单 · 无需配置 AI 即可使用</p>
    </section>
    <section class="auth-main">
      <div class="auth-form">
        <p class="eyebrow">
          {{ mode === "register" ? "开始使用" : "欢迎回来" }}
        </p>
        <h2>{{ title }}</h2>
        <p class="muted">
          {{
            mode === "register"
              ? "无需验证码，注册后即可使用。"
              : mode === 'forgot' ? '邮箱账户可通过重置邮件找回密码。' : "从这里接着做，进度会为你保留。"
          }}
        </p>
        <el-alert
          v-if="error"
          :title="error"
          type="error"
          :closable="false"
          show-icon
          role="alert"
        />
        <el-alert
          v-if="message"
          :title="message"
          type="success"
          :closable="false"
          show-icon
          role="status"
        />
        <el-form
          v-if="mode !== 'verify'"
          label-position="top"
          :novalidate="mode === 'register'"
          @submit.prevent="submit"
        >
          <div v-if="mode === 'register'" class="auth-register-methods" role="group" aria-label="注册方式"><button type="button" :aria-pressed="registrationKind === 'phone'" :disabled="busy" @click="chooseRegistration('phone')">手机号注册</button><button type="button" :aria-pressed="registrationKind === 'email'" :disabled="busy" @click="chooseRegistration('email')">邮箱注册</button></div>
          <el-form-item v-if="mode === 'register'" label="昵称（选填）"><el-input v-model="nickname" aria-label="昵称" autocomplete="nickname" maxlength="30" :disabled="busy" placeholder="填写你喜欢的昵称" /></el-form-item>
          <el-form-item v-if="mode !== 'reset'" :label="identifierLabel" :error="fieldErrors.identifier"
            ><el-input
              ref="identifierField"
              v-model="identifier"
              :type="identifierType"
              :inputmode="identifierType === 'tel' ? 'tel' : identifierType === 'email' ? 'email' : 'text'"
              :autocomplete="mode === 'register' ? registrationKind === 'phone' ? 'tel' : 'email' : mode === 'forgot' ? 'email' : 'username'"
              :aria-label="identifierLabel"
              :aria-invalid="Boolean(fieldErrors.identifier)"
              autocapitalize="none"
              :spellcheck="false"
              @input="fieldErrors.identifier = ''"
              required
              :placeholder="identifierPlaceholder"
              maxlength="254"
              :disabled="busy"
          /></el-form-item>
          <el-form-item
            v-if="mode !== 'forgot'"
            :label="mode === 'reset' ? '新密码' : '密码'"
            :error="fieldErrors.password"
            ><el-input
              ref="passwordField"
              v-model="password"
              type="password"
              :autocomplete="
                mode === 'login' ? 'current-password' : 'new-password'
              "
              aria-label="密码"
              :aria-invalid="Boolean(fieldErrors.password)"
              @input="fieldErrors.password = ''; checkConfirmation()"
              required
              :minlength="mode === 'login' ? 1 : 10"
              :maxlength="128"
              show-password
              :disabled="busy"
              :placeholder="
                mode === 'login' ? '输入你的密码' : '至少 10 个字符'
              "
          /></el-form-item>
          <el-form-item v-if="mode === 'register'" label="确认密码" :error="fieldErrors.confirmation"><el-input ref="confirmationField" v-model="confirmation" type="password" autocomplete="new-password" aria-label="确认密码" :aria-invalid="Boolean(fieldErrors.confirmation)" required maxlength="128" show-password :disabled="busy" placeholder="再次输入密码" @blur="confirmationTouched = true; checkConfirmation()" @input="checkConfirmation" /></el-form-item>
          <el-button
            class="auth-submit"
            type="primary"
            native-type="submit"
            :loading="busy"
            >{{
              mode === "register"
                ? "注册并进入工作台"
                : mode === "forgot"
                  ? "发送重置邮件"
                  : mode === "reset"
                    ? "保存新密码"
                    : "登录"
            }}<el-icon><ArrowRight /></el-icon
          ></el-button>
        </el-form>
        <div class="auth-links">
          <el-button
            v-if="mode !== 'register' && mode !== 'reset'"
            text
            :disabled="busy"
            @click="switchMode('register')"
            >创建账户</el-button
          >
          <el-button v-if="mode !== 'login'" text :disabled="busy" @click="switchMode('login')"
            >返回登录</el-button
          >
          <el-button v-if="mode === 'login'" text :disabled="busy" @click="switchMode('forgot')"
            >忘记密码</el-button
          >
        </div>
      </div>
    </section>
  </main>
</template>
