# 简库存 · Android 库存管理 MVP

一个使用 **Vue 3 + JavaScript + Vant + Capacitor** 开发的本地库存 App。首次打开为空数据，可以从新增商品开始使用。所有页面及资源随 APK 打包，业务不依赖服务器。

## 已实现

- 商品新增、详情查看、编辑、删除；按名称或编号搜索。
- 入库、出库、逐商品当前库存。
- 按时间显示出入库历史，可筛选类型，展示变更前后库存和备注。
- localStorage 持久化，刷新或重新打开后读取原记录。
- 名称与单位必填、非空商品编号唯一、正整数数量校验、库存不足和整数溢出保护。
- 有库存的商品禁止删除；库存归零后删除，历史快照仍保留。
- 本地写入失败不提交库存变更；启动数据损坏或版本不支持时阻止写入，避免覆盖原数据。
- 中文手机与桌面布局、空态、错误提示、删除确认。

扫码、OCR、AI、服务器后端、云同步和备份恢复属于后续里程碑。

## 快速运行

安装 Node.js 22.12 或更高版本，在项目根目录打开终端：

```sh
npm ci
npm run dev
```

打开终端显示的本地网址（默认 `http://127.0.0.1:5173`）。不要直接双击 `index.html` 或 `dist/index.html`。

```sh
npm test          # 核心业务、持久化和 store 自动测试
npm run build    # 生成 dist/ 生产网页
npm run preview  # 本地预览生产网页
```

依赖版本由 `package-lock.json` 锁定。已验证环境：Node 22.20.0、npm 10.9.3、JDK 21.0.11；Vue 3.5.43、Vant 4.10.2、Vite 7.3.6、Capacitor 8.5.2。

## 打包 Android APK

工程已包含 `android/`、Gradle Wrapper 和 Capacitor 配置，无需再次执行 `cap add android`。

准备 Android Studio 2025.2.1 或更高版本及以下组件：

- JDK 21（可用 Android Studio 自带 JDK）。
- Android SDK Platform 36、Build Tools 36.0.0、Platform Tools。
- 本工程使用 Android Gradle Plugin 8.13.0、Gradle 8.14.3，首次构建需要联网下载缺失依赖。

配置 `JAVA_HOME` 指向 JDK，`ANDROID_HOME` 指向 SDK。也可由 Android Studio 生成 `android/local.properties`，例如 Windows 下 `sdk.dir=C:/AndroidSdk`。此文件是本机路径，不提交到版本库。

从项目根目录执行：

```sh
npm ci
npm run android:debug
```

该命令先构建网页、同步网页资源到 Android，再执行 Gradle `assembleDebug`。结果位于：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Android Studio 路线：执行 `npm run android:sync`，然后 `npm run android:open`；或直接用 Android Studio 打开项目的 `android/` 目录，等待 Gradle 同步后选择 Build APK(s)。每次修改网页源码后，必须重新运行 `npm run android:sync`，再构建 APK。

如需单独从终端运行 Gradle：

```powershell
cd android
.\gradlew.bat assembleDebug
```

macOS/Linux 使用 `./gradlew assembleDebug`，必要时先执行 `chmod +x gradlew`。

应用 ID 为 `com.inventory.localapp`，最低 Android 7.0（API 24），目标 API 36。交付的 Debug APK 使用开发签名，适用于测试安装；正式发行需另行配置 Release 签名。安装时 Android 可能要求允许当前文件管理器安装未知来源应用。

旧设备请将 Android System WebView 更新到可用的新版本；最低系统版本并不代表原厂自带的旧网页内核支持所有界面功能。

## 使用示例

1. 在「商品」中新增“收纳盒”，编号 `BOX-001`，单位“盒”。初始库存为 0。
2. 打开商品详情点击「入库」，数量填 5，库存变为 5。
3. 点击「出库」，数量填 2，库存变为 3。
4. 出库 4 会显示库存不足，库存及流水保持不变。
5. 在「记录」中查看 `0 → 5` 与 `5 → 3`；重新打开仍保留。
6. 编辑商品名称不改写旧流水；出库归零后可删除商品，已有流水继续保留。

MVP 数量按整数记录，不支持小数。计量单位只是商品标签，请选择可按整数量取的单位。不同单位的库存不会被合并成没有意义的总数量。

## 源码结构

```text
src/App.vue                 页面、商品详情及出入库表单
src/style.css               手机与桌面样式
src/core/inventory.js        无浏览器依赖的库存规则
src/core/storage.js          localStorage 编解码、版本和流水一致性校验
src/store/inventoryStore.js  响应式状态与先保存后提交的操作
tests/                      Node 自动测试
scripts/build-android.mjs    跨平台 Debug 构建入口
android/                    Android Studio / Gradle 工程
capacitor.config.json       应用标识与网页构建目录
```

架构与代理分工见 [ARCHITECTURE.md](ARCHITECTURE.md)，交付核验见 [VERIFICATION.md](VERIFICATION.md)。

## 本地数据说明

浏览器中的记录属于当前网址和浏览器；Android App 中的记录属于该应用安装。两者不自动共享。卸载 App、清除 App 数据或浏览器站点数据会移除记录。本 MVP 以单个本地页面使用为前提，未实现多标签页并发编辑协调。

localStorage 键为 `inventory-mvp`，内容包含版本 1 的商品与流水。发现损坏数据时应用会显示保护提示，不会自动清空或替换数据。请先通过浏览器开发者工具保存原始值再诊断。

## 官方文档

- [Vue](https://vuejs.org/guide/introduction.html)
- [Vant 4](https://vant-ui.github.io/vant/)
- [Capacitor 环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Capacitor 开发与构建流程](https://capacitorjs.com/docs/basics/workflow)
