# 2026-10-10 设置页主题与时区发布

网页与安卓同步包含以下调整：设置页主题下拉选择后立即应用（保存后持久化到账户，未保存离开则保持服务端主题）；时区从自由文本输入改为可滚动、可搜索的下拉，551 个时区由 babel/CLDR 生成的中文名映射（`scripts/generate-timezone-names.py`）打包进前端，搜索同时匹配中文名、城市别名（如"上海"）和 IANA ID，选项值仍为 IANA 串，后端零改动。时区为空时回落默认中国时区 `Asia/Shanghai`。同期包含 AI 助手 SSE 帧解析守卫、到期提醒键按天清理，及 v1 页面密钥不再写入 localStorage。

## 云端

- 地址：`http://103.236.96.53:60673/`，构建哈希 `index-OJk2tIrJ.js` 与本地一致。
- 同步上线此前积累的后端修复：任务清除只清理引用被删任务的历史、worker 间隔可配置与连接复用、登录限流只计失败尝试、SSE 空闲退避；worker/web 增加健康检查，云端 Caddy 以非 root 运行并改听容器内 8080，宿主端口映射不变。
- 部署备份：`/opt/todo-list/.deploy-backups/settings-tz-20261010/`，数据库 `backups/todo-settings-tz-20261010.dump`，删除日志 `backups/deletion-journal-settings-tz-20261010.json`。
- 后端 416 项测试通过（4 项为修复前已存在的遗留失败）；公网实测注册、主题即选即变、中文时区搜索、保存与删除临时账户全部通过。

## 安卓

- 版本：`0.1.8-test`，versionCode `9`，包名 `cn.xiaoqi.todo.debug`。
- 下载：`http://103.236.96.53:60673/downloads/xiaoqi-todo-android-0.1.8.apk`。
- 本地文件：`tmp/releases/android/settings-tz-latest/xiaoqi-todo-android-0.1.8.apk`。
- 大小：26,454,432 字节。SHA-256：`f4590c265a892ea0e9c09e47c7b2e4e28914d431ed5cea96e8d457fb52cbc641`。公网完整下载内容已核对一致。
- 调试签名与此前版本一致，可以覆盖安装。APK 内置资源 301 个与 `dist-android` 逐字节一致（另有 Capacitor 标准注入的 cordova.js/cordova_plugins.js）。
- 13 项生产构建安卓前端分支检查通过（模拟原生插件接口）。没有进行实体手机安装测试。

网页刷新后生效；已安装安卓应用需下载并覆盖安装新版 APK 才能更新随包界面。`scripts/build-android.ps1` 本次补充了 UTF-8 BOM，修复 Windows PowerShell 5.1 下中文注释导致的解析失败；PowerShell 5.1 对原生命令 stderr 与 `ErrorActionPreference=Stop` 的兼容问题仍在，脚本内 java -version 检查在 5.1 下会误报终止，构建可按脚本步骤手动执行（npm run build:android → cap sync → gradlew assembleDebug）。
