# 安卓测试版

最新版本：`0.1.9-test`（versionCode 10），[下载 APK](http://103.236.96.53:60673/downloads/xiaoqi-todo-android-0.1.9.apk)。签名与 v0.1.8 一致，可覆盖安装。资讯分页与收藏修复已同步，详见 [2026-10-10 发布记录](releases/2026-10-10-news-pagination.md)。

安卓 App 复用 `frontend/` 的 Vue 界面，使用 Capacitor 8。界面、菜品和小狒资源随 APK 安装，任务、账号和 AI 使用现有云端服务，需要联网。默认服务器为 `http://103.236.96.53:60673`。

## 构建与安装

需要 Node.js 22+、JDK 21、Android SDK Platform 36 和 Build Tools 36.0.0。可以在 Android Studio 中安装 SDK，或使用命令行工具。本机便携工具保存在 `%LOCALAPPDATA%\todo-list-android`，不会替换系统 Java 8。

从项目根目录运行：

```powershell
./scripts/build-android.ps1
# 自定义工具路径：
./scripts/build-android.ps1 -JavaHome 'C:\tools\jdk-21' -AndroidSdk 'C:\tools\android-sdk'
# 使用 HTTPS 服务器：
./scripts/build-android.ps1 -ApiOrigin 'https://todo.example.com'
```

脚本构建 `dist-android/`、同步安卓资源、生成调试签名 APK，并复制至 `tmp/releases/android/`。将 APK 传到手机，允许该文件来源安装应用后打开。也可通过 USB 调试执行 `adb install -r <APK路径>`。测试应用包名为 `cn.xiaoqi.todo.debug`，名称为“小狒待办·测试版”，最低 Android 7.0，并需要 Chromium 111 或更新版本的系统 WebView；内核过旧时会显示更新提示。

`frontend/.env.android` 定义默认服务地址，构建脚本参数可覆盖。普通网页继续使用同源 `/api/v1`，`npm run build` 的输出仍是 `dist/`；构建安卓包不会覆盖网页构建。修改前端后重新执行构建脚本，生成的 APK 需要重新安装。

## 现有功能的安卓适配

- API 通过 CapacitorHttp 调用，HttpOnly 会话 Cookie 保存在安卓原生 Cookie 存储中。写操作仍携带服务来源与 CSRF 校验，不改变后端权限机制。
- 安卓路由使用 hash。返回键优先关闭对话框或抽屉，再返回上一页；根页面返回时最小化 App。
- 使用原生安全区域处理和 `adjustResize`，避免系统栏和软键盘遮挡内容。
- AI 使用两秒一次的运行状态查询，完成后显示回答、澄清或待确认提案，并恢复后续建议和引用。网页版保留 SSE 实时回复；当前安卓测试版没有逐字流式显示。
- 报告和 JSON 备份通过系统分享面板导出，可选保存位置或发送给其他应用。导入和聊天附件继续使用系统文件选择器。
- 小狒在 App 内显示，默认 2D，安卓页面隐藏 Windows 程序启动入口。保留 2D/3D 外观选择、拖动、专注和完成庆祝。
- 安装包只包含菜品目录引用的压缩图片，原始 PNG 仍保留在源码中供编辑使用。

## 测试与发布边界

```powershell
cd frontend
npx playwright test --config playwright.android.config.ts
```

以上浏览器测试模拟原生插件接口，验证安卓前端分支、接口来源与 CSRF、登录错误、任务保存、AI 状态恢复、文件导出、返回键、断网重试和窄屏布局；不能替代实际安卓 Cookie、WebView 和系统文件选择器的验证。

2026-10-08 验证结果：7 项安卓前端测试、18 项既有网页回归测试通过，APK 构建、签名检查和 Android lint 通过。在 Android 11 模拟器中通过真实原生 HTTP 桥接验证了云端注册/登录、任务保存/读取、CSRF 拒绝、PDF 下载、退出，以及进程关闭并重新启动后的登录保持；临时测试账号已删除。模拟器自带 WebView 83，因此完整界面验证使用生产构建的浏览器测试，模拟器中确认了旧内核更新提示。手机系统分享面板和完整界面仍需安装后实测。

HTTP 仅在 debug 网络配置中对现有服务器 IP 开放。正式版禁止明文网络，需先配置 HTTPS 服务地址、正式签名和发布版本。测试版使用调试签名；请保留本机的调试签名文件，以便后续覆盖安装。更换签名需要卸载旧包，App 内偏好会被清除，云端任务不受影响。

本版不包含系统悬浮宠物、离线任务编辑、桌面小组件或后台任务通知。AI 需要用户在账户设置中配置可用模型，当前服务器 SMTP 尚未配置，邮件找回密码受此限制。

2026-10-08 更新：测试包版本提升为 `0.1.1-test`（versionCode 2），文件位于 `tmp/releases/android/checklist-weather-latest/小狒待办-Android-测试版-v0.1.1-20261008.apk`。包含日历圆形日期、紧凑待办、专注分钟滚轮及初始定位修复、AI 建议移至输入框上方、三餐同屏，以及四个周期清单统一天气栏。9 项安卓生产构建原生分支检查和 10 项网页天气/位置检查通过；APK 中 301 个前端资源与本次 `dist-android` 完全一致。应用 ID 仍为 `cn.xiaoqi.todo.debug`，签名证书保持一致，可以覆盖安装。APK SHA-256 为 `f5babdbab2e7c133f692e49c3ff6f93cbeb234219196ec86d026cf2d74509bb2`。

2026-10-08 更新：测试包提升为 `0.1.2-test`（versionCode 3），位于 `tmp/releases/android/ai-recurrence-latest/小狒待办-Android-测试版-v0.1.2-20261008.apk`。新增 AI 周期任务预览，显示每日/每周/每月频率、间隔、开始日期和生成方式；云端支持确认后新建周期任务或把普通任务设为周期任务，保留已有任务并生成后续实例。104 项后端检查、4 项网页检查和 10 项安卓分支检查通过，包含原生查询恢复周期提案与确认流程。APK 的 301 个前端资源与生产构建逐字节一致，版本、应用 ID 和签名已验证，仍可覆盖安装。APK SHA-256 为 `d0a6ff544a7ac57361e16fe6d40c4d05faa690ad270b6907e170d46fced7749c`，大小约 26 MB。

2026-10-09 更新：测试包提升为 `0.1.3-test`（versionCode 4），位于 `tmp/releases/android/general-news-latest/小狒待办-Android-测试版-v0.1.3.apk`。新增通用资讯标识；历史与记忆采用正文、状态、操作分层排版，新增表单默认收起；手机日历缩小任务间距，截止信息与操作并排。云端资讯补充社会、生活、科技与文化内容，没有兴趣记忆时也可生成。22 项后端检查、18 项本地网页检查、12 项公网实际资源页面检查及 10 项安卓分支检查通过；公网检查模拟接口数据，没有改动用户任务或记忆。APK 中 301 个前端资源与 `dist-android` 一致，应用 ID 与签名保持一致，可以覆盖安装。APK SHA-256 为 `0b06784bb17377bcb9df32211d42c4b6e68ba185a8728fb820d33e9e07b3e306`，大小约 26 MB。

2026-10-09 更新：测试包提升为 `0.1.4-test`（versionCode 5），位于 `tmp/releases/android/greetings-latest/小狒待办-Android-测试版-v0.1.4.apk`。每次点击新对话，小狒即时给出随机开场白；同一对话保存原句，直接回复简短文字时模型可以读到开场白。开场使用 48 种温和短句组合，避免与上一个新对话重复，不读取私人任务、制造截止提醒或额外调用模型。保留桌面和手机快捷建议，未配置模型时仍可看到开场与模型连接入口。103 项后端检查、6 项本地网页检查和 11 项安卓分支检查通过，涵盖保存、去重、用户隔离、旧对话、附件、日常聊天、周期提案及确认撤销。最终 APK 中 301 个前端文件与 `dist-android` 一致，版本和签名已核验，可以覆盖安装。APK SHA-256 为 `820968fea08b42c1215604aec34cc7a95c94385929a6aa08a3df052d2221682c`，大小约 26 MB。


2026-10-09 更新：测试包提升为 `0.1.5-test`（versionCode 6），位于 `tmp/releases/android/retention-latest/小狒待办-Android-测试版-v0.1.5.apk`。修复离开 AI 助手页面后当前对话消失的问题；各端保持助手组件，切页保留消息、未发送草稿、附件和运行状态。按账号保存最近选中的对话 ID，文字草稿仅保留在当前标签页的会话存储，刷新可恢复；退出账号清理保存状态。已删除的对话会自动退回可用状态，刷新不保存待发送附件。12 项安卓生产构建原生分支检查通过，其中新增跨页面保留当前聊天与草稿；网页切页、刷新、账号隔离及切页期间收到回答的检查通过。APK 中 301 个资源与 `dist-android` 一致，应用 ID 与调试签名保持一致，可覆盖安装。APK SHA-256 为 `c71c69b3edf33aa7ebc4f4e1bad9956c850d9bdc1182d8ff82b963652195c9a8`，大小 27,234,052 字节（约 26 MB）。


2026-10-09 更新：测试包提升为 `0.1.6-test`（versionCode 7），位于 `tmp/releases/android/assistant-data-latest/小狒待办-Android-测试版-v0.1.6.apk`。小狒可以按账号权限查询完整应用资料（含账号、隐藏任务、垃圾站、历史和对话）；在对话内导出账号资料 JSON、任务明细，以及周报和月报的 Excel/Word/PDF/CSV 文件。下载卡片随对话保存，安卓点击保存或分享调用系统面板；修复原生二进制接口返回 JSON 时的 Base64 解码，中文资料正确保留。密码、密钥和登录凭据排除，已遗忘资料及相关下载不恢复。13 项安卓生产构建原生分支检查通过，包括中文 JSON 导出与系统分享、已有报告和任务流程；APK 中 301 个资源与 `dist-android` 一致，包名和调试签名不变，可覆盖安装。APK SHA-256 为 `1ee4754315314554127c56dcf28cb8d5a713d8919937e25274423301d31b189c`，大小 27,234,892 字节。浏览器检查模拟原生接口，本次完整系统分享交互仍需手机安装验证。使用方式见 `docs/ASSISTANT-DATA.md`。

2026-10-10 更新：测试包提升为 `0.1.8-test`（versionCode 9），位于 `tmp/releases/android/settings-tz-latest/xiaoqi-todo-android-0.1.8.apk`。设置页主题下拉即选即生效（保存后持久化）；时区改为可滚动、可搜索的中文下拉（babel/CLDR 生成 551 个中文名映射，支持"上海"等城市别名与 IANA ID 搜索，值仍为 IANA 串）。包含同期网页修复：AI 助手 SSE 帧解析守卫、到期提醒键按天清理。13 项安卓分支检查通过；APK 中 301 个前端资源与 `dist-android` 逐字节一致，签名一致可覆盖安装。APK SHA-256 为 `f4590c265a892ea0e9c09e47c7b2e4e28914d431ed5cea96e8d457fb52cbc641`，大小 26,454,432 字节。构建脚本补充 UTF-8 BOM 修复 PS 5.1 解析失败，详见发布记录。

2026-10-10 更新：测试包提升为 `0.1.9-test`（versionCode 10），位于 `tmp/releases/android/news-pagination-latest/xiaoqi-todo-android-0.1.9.apk`。资讯列表分页展示（每页 5 条，切换推荐/已收藏回第一页）；修复修改关注主题后旧收藏文章消失的问题——已收藏文章不再被主题过滤，改主题后仍在"已收藏"可见。13 项安卓分支检查通过（此前已跑，本次界面复用同一构建管线）；APK 内置资源与 `dist-android` 一致（另含 Capacitor 标准注入文件），签名一致可覆盖安装。APK SHA-256 为 `eb086bb76b408932deb898aebd72527168c0c8560cda4b4a24a0d6f524ced753`，大小 26,454,680 字节。
