# 桌面壳方案对比（Electron 太大了怎么办）

> 目标不变：类 SmartGit 的 Git 客户端，Windows 优先  
> 本文回答一个问题：**不背 Chromium 那 100MB，还有什么路**

---

## 0. 先把体积这件事拆成两笔账

安装包大小 = **运行时（渲染引擎 + 语言运行时）** + **随包二进制（git）**

很多人只算第一笔，结果换完壳发现还是 40MB。以本项目为例：

| 组成 | Electron 方案 | Tauri 方案 |
| --- | --- | --- |
| 渲染引擎 | Chromium ~80-100MB（必带） | WebView2，系统自带（0MB） |
| 语言运行时 | Node ~40MB（必带） | Rust 编进单文件（~3-6MB） |
| git 二进制 | dugite ~40MB | **按策略可选：0MB / 38MB** |
| **合计（不含 git）** | **~100-170MB** | **~1-6MB** |
| **合计（含 MinGit）** | **~150-170MB** | **~40-45MB** |

实测数据（第三方同机对比，来源见文末）：
- 极简应用：Tauri 2.12 NSIS **1.05MB** vs Electron **106.1MB**
- 真实小工具：Electron **168.9MB** vs Tauri 便携版 **5.51MB**（签名安装包 **2.64MB**）
- Tauri 官方给的 WebView2 三种打包方式：`downloadBootstrapper` **+0MB**（用户机没装则联网下载）、`embedBootstrapper` **+1.8MB**、`offlineInstaller` **+127MB**

**关键结论**：Tauri 的真实安装包落在 **2.6-6MB** 这一档。但如果你把 MinGit（64 位 zip 实测 **37-38MB**）塞进去，收益立刻缩水到「Electron 的 1/3」，不算质变。所以「换壳」这件事必须和「git 从哪来」一起决策。

---

## 1. 六个候选方案

| # | 方案 | 安装包 | 冷启动 | 相对 Electron 工期 | 主要代价 |
| --- | --- | --- | --- | --- | --- |
| A | **Tauri 2 + 系统 git**（推荐） | **2.6-6MB** | ~0.4s | +25% | 三引擎差异（Win 只有 WebView2 一种，影响小）；调试链弱一点 |
| B | Tauri 2 + 内置 MinGit | 40-45MB | ~0.4s | +30% | 体积回到 1/3 档；MinGit 功能裁剪（无交互命令） |
| C | Tauri 2 + gix（纯 Rust git） | 8-12MB | ~0.4s | +80% | gix 写操作（rebase/merge/hook）覆盖不全，风险最高 |
| D | Wails（Go + 系统 WebView） | 10-20MB | ~0.5s | +40% | Go+TS 双语言；生态和文档远不如 Tauri |
| E | .NET 8 + Avalonia + LibGit2Sharp | 8MB（框架依赖）/ 25-60MB（自包含） | ~0.5s | +40% | 框架依赖要用户装 .NET 运行时；libgit2 老问题 |
| F | 纯 Rust 原生（egui / gpui） | 8-15MB | ~0.15s | ×2 | diff 编辑器 / 表格 / 选中 / IME 全部手写，不建议 |
| G | Flutter Desktop | 20-30MB | ~0.8s | +50% | 自绘引擎一致性最好，但代码编辑器生态弱 |
| H | Electron 瘦身（不内置 git + 差分打包） | 70-90MB | ~1.5s | 0 | Chromium 地板拆不掉，只能小改 |

---

## 2. 推荐：A. Tauri 2 + 系统 git + 可选下载 MinGit

### 2.1 为什么是这个

1. **Windows 上的 WebView2 就是 Chromium 内核**，和 Electron 的渲染行为几乎无差异。所谓「三引擎地狱」主要在 macOS（WKWebView）和 Linux（WebKitGTK），我们一期只做 Windows，这个风险被消掉了。Canvas 2D、CodeMirror 6、虚拟滚动在 WebView2 上表现和 Chrome 一致。
2. **UI 代码 100% 复用**：React + Vite 那套照旧，`src-tauri` 只是外壳。
3. **Rust 侧只写薄薄一层**：不做 Git 语义，只做「进程启动 + 管道转发 + 窗口/菜单/文件对话框」。预计 1500-2500 行，不构成学习黑洞。
4. **保留换回 Electron 的后路**：只要 IPC 适配层是独立的（见下），随时能切。

### 2.2 关键设计：Rust 只做进程管理，解析留在 TS

这是把 Tauri 迁移成本压到最低的核心技巧。

```
WebView (React + TS)                     Rust (src-tauri)
┌────────────────────────┐               ┌─────────────────────────┐
│ GitService (TS)        │  invoke       │ 桥接层（薄）             │
│  ├ spawnGit(argv)  ────┼──────────────>│  spawn(git, argv)        │
│  ├ 增量流拼接      <────┼── emit chunk ─│  stdout chunk → event    │
│  ├ parse/* (纯函数)    │               │  超时 / kill / AbortId   │
│  └ Worker 里解析大输出  │               │  不解析 Git 输出         │
└────────────────────────┘               └─────────────────────────┘
```

好处：
- 所有 `parse/*`（porcelain / log / diff / blame）仍是 TS 纯函数，**单元测试和 Electron 方案完全一样**，一行不用改
- 换成 Electron 时只替换 `spawnGit` 的适配层（一个文件）
- 大输出（`git log` 几十万行）在 Web Worker 里解析，不卡 UI

代价与对策：
- **IPC 是 JSON 序列化**。对策：大 payload 走「Rust 分块 emit 原始文本 → Worker 拼接解析」，不让结构化数据过大；热路径（提交图分页 200 条）结构本身很小，无压力
- **没有 Node 生态**：`chokidar` / `keytar` 之类要换 Rust crate（`notify` / `keyring`），实际都有一等公民实现，不用自己写

### 2.3 git 二进制三级策略（体积与一致性的折中）

| 层级 | 行为 | 体积代价 |
| --- | --- | --- |
| L1 默认 | 探测系统 git（`where git` + `git --version` ≥ 2.23），用系统的 | 0 |
| L2 兜底（首次启动检测不到时提示） | 一键下载 MinGit 到 `%LOCALAPPDATA%\GitDesk\git\`，用户在设置里可随时删 | 0（不随包） |
| L3 自定义 | 用户手动指定 git.exe 路径（比如公司统一版本） | 0 |

这样安装包 **~3MB**，同时不会出现「用户没装 git 就用不了」。
只有当你确认「必须开箱即用、零网络」时，才退到方案 B（内置 MinGit，约 40MB）。

> 注意 MinGit 的裁剪：不含 `git help`、本地化消息、部分交互式命令。我们用到的全是 plumbing，不受影响；但要**避免**依赖 `git add -p`、`git gui` 这类交互式命令。

---

## 3. 如果一定要「引擎一致 + 单文件」，选谁

按「能不能真做出来」排序：

1. **.NET 8 + Avalonia + AvaloniaEdit + LibGit2Sharp** —— Windows 上框架依赖包只有 **8MB** 左右，但用户机器得有 .NET 8 运行时（Win11 自带的不一定是 8）。NativeAOT 单文件约 25-40MB。AvaloniaEdit 是现成的代码编辑器控件，diff 展示不用从零写。代价：libgit2 的老毛病（偶发 index 损坏）、UI 迭代比 Web 慢一档。
2. **Flutter Desktop** —— 自绘引擎，三平台像素级一致，包 20-30MB。但代码编辑器（`flutter_code_editor`）成熟度不如 CodeMirror，中文 IME 在自绘输入框里要额外调。
3. **纯 Rust gpui / egui** —— 体积最香，工期 ×2，不推荐一期做。

---

## 4. 我的建议

**选 A：Tauri 2 + 系统 git + 可选下载 MinGit。安装包 3MB 级，UI 代码零改动，Rust 只写外壳。**

理由排序：工期（最接近原方案）> 体积（30-50 倍缩减）> 风险（Windows 上 WebView2 = Chromium，可控）。

需要你确认两件事：
1. **同意"默认用系统 git、缺失时引导下载"吗？** 如果要求绝对开箱即用 → 走方案 B，安装包约 40MB（仍比 Electron 好 3-4 倍）。
2. **一期只做 Windows 吗？** 如果现在就要 macOS，WebView 三引擎差异要额外留 1 周预算（主要是字体渲染、滚动条、剪贴板、文件拖放行为的差异）。

---

## 附：数据来源

- Tauri 官方《Windows Installer》文档（`downloadBootstrapper` / `embedBootstrapper` / `offlineInstaller` 三种体积选项） — https://v2.tauri.app/distribute/windows-installer/
- 同机同应用的 Tauri 2.12 vs Electron 106.1MB 对比实测 — https://dawloom.com/blog/tauri-vs-electron-vs-wpf-benchmark/
- Electron 168.9MB vs Tauri 2.64MB 签名安装包对比实测 — https://lawsonhart.me/posts/projects/fivelaunch/
- MinGit 官方说明（功能裁剪范围） — https://gitforwindows.org/mingit
- MinGit 2.54.0 / 2.55.0 64 位 zip 实际体积 37-38MB — https://github.com/git-for-windows/git/releases
