# 2026-10-10 资讯分页与收藏修复发布

资讯页面改为分页展示，每页 5 条；切换"推荐/已收藏"回到第一页，后台刷新保持当前页。修复修改关注主题后旧收藏文章消失的问题：后端 `/recommendations` 之前会把主题不匹配的文章连同已收藏的一起过滤掉，现在已收藏文章豁免主题过滤（与关闭推荐时保留收藏的逻辑一致），改主题后旧收藏仍在"已收藏"视图可见。

## 云端

- 地址：`http://103.236.96.53:60673/`，构建哈希 `index-C8CIPIoS.js` 与本地一致；API/worker 镜像重建，健康检查通过。
- 部署备份：`/opt/todo-list/.deploy-backups/news-pagination-20261010/`，数据库 `backups/todo-news-pagination-20261010.dump`。
- 后端 416 项测试通过（4 项为既有遗留失败）；更新了原"改主题隐藏全部"断言的测试，改为断言收藏豁免。公网回归：临时账号注册、设置关注主题、资讯接口、删除账号全部通过。

## 安卓

- 版本：`0.1.9-test`，versionCode `10`，包名 `cn.xiaoqi.todo.debug`。
- 下载：`http://103.236.96.53:60673/downloads/xiaoqi-todo-android-0.1.9.apk`。
- 本地文件：`tmp/releases/android/news-pagination-latest/xiaoqi-todo-android-0.1.9.apk`。
- 大小：26,454,680 字节。SHA-256：`eb086bb76b408932deb898aebd72527168c0c8560cda4b4a24a0d6f524ced753`。公网完整下载内容已核对一致。
- 调试签名与此前版本一致，可覆盖安装；APK 内置资源与 `dist-android` 一致（另含 Capacitor 标准注入文件）。

网页刷新后生效；已安装安卓应用需覆盖安装新版 APK 才能更新随包界面。
