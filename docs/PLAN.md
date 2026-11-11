# GitDesk —— 类 SmartGit 的 Git 图形客户端 · 技术方案

> 状态：方案待评审（v2：桌面壳已从 Electron 换为 Tauri 2）  
> 目标平台：Windows 优先（当前环境 Win + git 2.43 + Node 18.19；需补装 Rust stable + MSVC 生成工具），后续 macOS / Linux  
> 定位：单机桌面应用，不做云端代码托管，只做本地仓库的「看得懂 + 改得动」工作台  
> 相关文档：`docs/SHELL-COMPARISON.md`（壳选型与体积实测）

---

## 1. 产品定位与差异化

SmartGit / Fork / SourceTree / GitKraken 已经把「基础 Git 操作」做完了。要从零做一个能自己长期用的，靠的是三件别人做得不够好的事：

| 痛点 | 我们的做法 |
| --- | --- |
| 大仓库卡（Linux kernel、monorepo） | 全链路增量 + worker 线程 + 虚拟化渲染，首屏只读 200 条提交 |
| 行为与命令行不一致（GUI 悄悄改写历史） | **所有写操作都打印等价 git 命令**，可复制、可回溯、可"再确认一次" |
| 冲突解决难 | 三层合并编辑器（base / ours / theirs），按 hunk 采纳，语义高亮 |
| 黑盒感 | 内置「操作日志」面板：每条命令 + 耗时 + 退出码 + stderr |

结论：**不做 Git 的替代实现，做 Git 的高保真外壳（shell-out 到官方 git 二进制）**。

---

## 2. 技术选型

### 2.1 主框架：Electron vs Tauri

> v2 修订：安装包体积是硬指标，已从 Electron 改为 **Tauri 2**。完整对比与实测数据见 `docs/SHELL-COMPARISON.md`。

| 维度 | Electron 30 + React | **Tauri 2 + React** |
| --- | --- | --- |
| 安装包 | 100-170MB | **2.6-6MB** |
| 渲染引擎 | 自带 Chromium | 系统 WebView2（Win 上就是 Chromium） |
| 启动 | ~1.5s | ~0.4s |
| 后端语言 | Node（纯 TS，单一语言） | Rust（薄壳）+ TS（解析） |
| 开发速度 | 基线 | +25% |
| 生态（diff 编辑器、虚拟列表） | 成熟 | 同一套 Web 生态，一样成熟 |
| 调试 | 一等公民 | devtools 需显式开启，略弱 |

**决策：Tauri 2 + React + TypeScript。**  
体积实测差距在 30-50 倍量级（1.05MB vs 106.1MB 的公开基准），而 UI 代码零改动。隐藏成本主要在 Rust 工具链和调试体验，不在功能能力。

**把迁移成本压到最低的关键约束（必须遵守）**：
1. Rust 侧**不实现任何 Git 语义**，只做「spawn 进程 + 流式转发 stdout + 超时/取消 + 窗口/菜单/对话框」。
2. Git 输出的**解析全部留在 TS**（`parse/*` 纯函数 + Web Worker），这样解析代码和单元测试与壳无关。
3. IPC 收敛到单一的 `GitRunner` 适配层（一个文件），换壳时只改它。

> Windows 上 WebView2 即 Chromium 内核，Canvas / CodeMirror / 虚拟滚动的表现与 Electron 一致；常被诟病的「三引擎地狱」只在一期之后做 macOS/Linux 时才需要买单。

### 2.2 Git 访问层：shell-out vs libgit2

**决策：主用 git CLI（plumbing 命令），libgit2/gix 仅作可选加速。**

| 方案 | 优点 | 致命问题 |
| --- | --- | --- |
| `git` CLI（spawn，数组参数） | 语义 100% 与用户命令行一致；hooks / merge / rebase / credential / ssh 全部现成；永不和 git 版本行为漂移 | 进程启动开销（~10-20ms），需流式解析输出 |
| libgit2 (`nodegit` / `git2-rs`) | 无进程开销、内存内对象访问 | index/packfile 偶发损坏风险；不支持 rebase interactive、部分 hooks 语义；与 git 版本行为差异 |
| isomorphic-git（纯 JS） | 无二进制依赖 | 慢（大仓库不可用）、支持面窄，直接排除 |

具体分工：
- 读操作：`git log --format=… -z`、`git for-each-ref`、`git cat-file --batch`、`git diff --no-color -U0`
- 写操作：`git add`、`git commit`、`git switch/checkout`、`git merge/rebase`、`git push/pull`
- 状态：`git status --porcelain=v2 -z --branch`（唯一真源，不用自己维护 index 状态）
- git 二进制来源（三级策略，决定安装包体积）：

  | 层级 | 行为 | 体积代价 |
  | --- | --- | --- |
  | L1 默认 | 探测系统 git（`git --version` ≥ 2.23），直接用 | 0 |
  | L2 兜底 | 检测不到时引导一键下载 MinGit（64 位 zip 约 38MB）到 `%LOCALAPPDATA%\GitDesk\git\` | 不随包，0 |
  | L3 自定义 | 设置里手动指定 git.exe（公司统一版本场景） | 0 |

  只有在「必须离线开箱即用」时才改为内置 MinGit，安装包约 40MB（仍比 Electron 好 3-4 倍）。注意 MinGit 裁掉了交互式命令，本方案只用 plumbing，不受影响——但**禁止**依赖 `git add -p`、`git gui`。

### 2.3 前端技术栈

| 关注点 | 选择 | 说明 |
| --- | --- | --- |
| 框架 | React 18 + TypeScript | — |
| 构建 | Vite + @tauri-apps/cli | 前端 HMR 与 Electron 方案一致，`src-tauri` 独立 cargo 构建 |
| 状态 | Zustand（UI 态）+ TanStack Query（服务端态/仓库数据缓存） | 仓库数据本质是异步查询，Query 的失效与分页天然匹配 |
| 提交图 | 自研 Canvas 渲染（虚拟滚动） | DOM/SVG 在 5 万+ 提交时崩；Canvas + 分层缓存 |
| Diff 视图 | CodeMirror 6 + 自研 split/unified 装饰层 | 比 Monaco 轻 10 倍，适合自定义 diff 高亮；语法高亮用 Lezer |
| 合并编辑器 | CodeMirror 6 三实例 + 同步滚动 + 横向 hunk 导航 | 不做 4 窗格（避免复杂度爆炸），用 base 内联展示 |
| 样式 | Tailwind + Radix Primitives | 主题切换（亮/暗/系统）成本低 |
| 图标 | lucide-react | — |
| 快捷键 | 自研 command registry（类似 VSCode keybinding） | 命令既可点也可按，命令既是 UI 也是 IPC 镜像 |
| 打包 | tauri bundler（NSIS，`downloadBootstrapper` 模式） | 安装包 ~3MB；后续加 dmg / AppImage |

---

## 3. 架构

```
┌──────────────────────────────────────────────────────────────────┐
│ WebView (React) —— 与壳无关，可直接搬回 Electron                     │
│  ┌──────────┬────────────┬──────────┬───────────┬────────────┐    │
│  │ 侧栏     │ 提交图      │ 变更列表  │ Diff/合并  │ 操作日志    │    │
│  │ 分支/标签│ Canvas     │ 文件树    │ CM6       │ 命令回显    │    │
│  └──────────┴────────────┴──────────┴───────────┴────────────┘    │
│  GitService(TS)  ── 组装 argv / 拼流 / 解析 / 分页                  │
│    └── parse/*  纯函数（porcelain / log / diff / blame）           │
│    └── Web Worker：提交图 lane 布局 / 大输出解析 / word-diff        │
│  Zustand（UI 态） / TanStack Query（仓库数据缓存）                  │
└──────────────────────────────┬───────────────────────────────────┘
                               │ @tauri-apps/api invoke + event
┌──────────────────────────────┴───────────────────────────────────┐
│ src-tauri (Rust) —— 薄壳，不含 Git 语义                            │
│  ┌────────────┬──────────────┬─────────────┬──────────────────┐  │
│  │ spawn_git  │ notify::watch│ keyring     │ 窗口/菜单/对话框   │  │
│  │ argv 数组   │ 文件变更      │ 凭据存取     │ 最近仓库/拖放     │  │
│  │ 超时/kill   │              │             │                  │  │
│  └─────┬──────┴──────────────┴─────────────┴──────────────────┘  │
│        │ stdout chunk → emit 事件（原始文本，不做结构化）           │
└────────┼─────────────────────────────────────────────────────────┘
         │
    git 二进制（系统 git 优先，缺失时下载 MinGit）
```

关键约束（写进 lint 规则 / review checklist）：
1. **禁止 shell 字符串拼接**：一律传 argv 数组给 `Command::new(bin).args([...])`，杜绝注入。
2. Rust 侧**不解析 Git 输出**，只转发原始字节/文本；解析只在 TS。
3. WebView 无 Node 权限，不触碰 `fs`/进程；Tauri capability 白名单只开 `spawn_git`、`watch`、`keyring`、`dialog`。
4. 所有 IPC 入参在两侧都用 zod / serde 校验，非法直接拒绝。
5. 每个 Git 命令都可取消（前端传 `opId`，Rust 侧 `child.kill()`），比如切分支时立刻终止旧的 log 流。
6. 大 payload 不走 JSON：Rust 按块 emit 原始文本，前端在 Worker 里拼接解析。

---

## 4. 核心功能范围

### M1（只读，MVP 的"看得见"）
- 打开仓库 / 最近仓库 / 拖入文件夹；多处同时开多个仓库（标签页）
- **提交图**：拓扑排序 + lane 分配，分支名/标签/HEAD 徽标，右侧紧凑文件列表
- 提交详情：作者/时间/父提交/hash、提交信息、变更文件列表
- Diff 视图：unified / split 切换，语法高亮，word-level 高亮，空白符开关，文件折叠
- 变更（工作区）：`git status -z` 分级展示 staged / unstaged / untracked / conflicted
- 文件历史（follow renames）、blame（按行 hover 显示提交）
- 引用树：branches（local/remote）/ tags / stashes / remotes，搜索过滤

### M2（写操作基础）
- **hunk / 行级 stage / unstage / discard**（这是 SmartGit 的灵魂功能，必须做对）
- 提交：amend、author 覆盖、sign-off、提交前 hook 输出展示
- 分支：创建 / 切换 / 重命名 / 删除；checkout 时脏工作区策略提示
- Tag：轻量/附注、删除、推送
- Stash：save/pop/apply/drop，带消息
- Undo：对**非破坏性操作**提供撤销（记录操作前后的 ref 快照）

### M3（远程 + 合并）
- Remote：fetch / pull（--rebase 可配）/ push（force-with-lease 而非 --force）/ 跟踪分支设置
- 凭据：调用 `git credential fill`，命中则用；SSH 用 agent；HTTPS token 存 Windows Credential Manager（keytar）
- **冲突解决**：三层编辑器 + 冲突文件列表 + 「采用我方/对方/两者」+ mark resolved
- Merge / Rebase（含 simple interactive rebase：拖拽排序、squash、reword、drop）
- Cherry-pick / revert / reset（soft/mixed/hard，hard 要二次确认）

### M4（打磨，决定能不能长期用）
- 命令面板（Ctrl+Shift+P）+ 全量快捷键自定义
- 内置「Git 命令日志」+ 一键复制命令
- 全局搜索：提交信息 / 内容（`git grep`）/ 文件路径
- 子模块、worktree 列表（只读 + 基础操作）
- 主题、i18n（中英）、字体缩放、屏幕阅读器基本支持
- 自动更新（tauri-plugin-updater）

---

## 5. 三个硬核技术点

### 5.1 提交图布局（lane assignment）
- 输入：`git log --all --topo-order --parents --format=…`（流式逐行）
- 算法：维护 active lanes 数组，逐提交：
  - 找当前提交 hash 是否在 active lanes 中；是 → 复用该 lane，否则新开 lane
  - 提交的 parents：第一个 parent 继承当前 lane，其余 parent 各占 lane（若已存在则连线合并）
  - 已闭合的 lane 标记可复用（类似 gitk / git-graph 的 `allocLane`）
- 输出：`{ row, lane, edges: [{fromLane, toLane, color}], color }`，纯 data，交给 Canvas
- 性能：把该计算放进 Worker，按页（200 条）计算并缓存，滚动时拼接 lane 状态（需要把 lane 快照随分页一起存，否则拼接会错）

### 5.2 Diff 与 hunk 级 stage
- 内容来源：`git diff --no-color -U3 -- <path>`；二进制/大文件走 lazy 加载（>1MB 只显示统计 + "打开外部编辑器"）
- 行 diff 用 git 自带的 Myers/histogram（`--diff-algorithm=histogram`），不自研
- **word-level**：对配对的行做二次 diff（token 化后 LCS），只在渲染层做，缓存 key = 两行 hash
- hunk 级 stage 的实现路径（三种，依次尝试）：
  1. `git apply --cached --recount`（把选中的行拼成 patch，喂 stdin）——最干净
  2. 行级 stage：`git apply --cached -U0` 加 3-way 校验失败时，退化到「临时 index 树 + checkout-index」
  3. 兜底：写临时文件 + `git add -p` 的等价逻辑自实现
- 必须处理：CRLF、文件模式变更、重命名、文件末尾无换行

### 5.3 三层合并编辑器
- 数据源：`git show :1:path`（base）/ `:2:`（ours）/ `:3:`（theirs）
- 展示：左右两栏（ours / theirs）+ 中间结果区；base 在冲突块内以小字内联
- 冲突块导航：下一个/上一个冲突按钮 + 侧边 minimap
- 解决动作：take ours / take theirs / take both / manual edit → 全部冲突块消除后写入工作区并 `git add`
- 注意：不做自动语义合并（那是 IDE 的活），只做「块级选择 + 手改 + 校验」

---

## 6. IPC 契约（示意）

```ts
// 所有调用形态统一：{ id, method, params } → { ok, data } | { ok:false, error:{code,message,detail} }
type GitOp =
  | { method: 'repo.open';      params: { path: string } }
  | { method: 'repo.status';    params: { repoId: string } }
  | { method: 'log.page';       params: { repoId: string; refs: string[]; skip: number; limit: number } }
  | { method: 'diff.commit';    params: { repoId: string; sha: string; path: string; context: 0|3|full } }
  | { method: 'diff.worktree';  params: { repoId: string; path: string; staged: boolean } }
  | { method: 'index.apply';    params: { repoId: string; path: string; patch: string; reverse: boolean } }
  | { method: 'commit.create';  params: { repoId: string; message: string; amend: boolean; paths: string[] } }
  | { method: 'branch.switch';  params: { repoId: string; name: string; strategy: 'carry'|'stash'|'discard' } }
  | { method: 'remote.push';    params: { repoId: string; remote: string; ref: string; forceWithLease?: string } };
```

每个方法在 Main 侧对应一个 handler，handler 内部**只做参数校验 + 组装 argv**，实际执行与解析在下层 runner/parser。

---

## 7. 目录结构

```
gitdesk/
├─ package.json
├─ vite.config.ts
├─ src/                        # 前端（与壳无关）
│  ├─ app/                     # 布局、主题、路由
│  ├─ features/graph/          # canvas 渲染 + lane 布局消费
│  ├─ features/changes/        # 状态树 + hunk 选择
│  ├─ features/diff/           # CM6 扩展
│  ├─ features/merge/
│  ├─ features/command/        # command registry + palette
│  ├─ git/
│  │  ├─ runner.ts             # ★ 壳适配层：调 tauri spawn_git + 拼流
│  │  ├─ bin.ts                # 系统 git 探测 / MinGit 下载与路径管理
│  │  └─ ops/                  # log.ts status.ts diff.ts index.ts branch.ts remote.ts
│  ├─ parse/                   # porcelain / log / diff / blame 解析器（纯函数，可测）
│  ├─ workers/                 # graph.worker.ts diff.worker.ts
│  └─ stores/
├─ src-tauri/
│  ├─ Cargo.toml
│  ├─ tauri.conf.json
│  ├─ capabilities/            # IPC 白名单（最小权限）
│  └─ src/
│     ├─ main.rs
│     ├─ git_cmd.rs            # spawn + 超时 + kill + 流式 emit（无解析）
│     ├─ watcher.rs            # notify 目录监听（debounce）
│     ├─ creds.rs              # keyring → Windows Credential Manager
│     └─ menu.rs               # 原生菜单 / 托盘 / 文件对话框
└─ tests/                      # vitest：解析器 + lane 算法 + patch 生成
```

**可测性设计**：所有 `parse/*` 和 lane 算法是纯函数（输入字符串 → 输出结构），不依赖 Electron，用真实仓库 fixture 做快照测试。这块覆盖率目标 80%+，因为 Git 输出格式的坑全在这里。

---

## 8. 里程碑与工期（单人）

| 阶段 | 内容 | 估时 |
| --- | --- | --- |
| M0 | 骨架：tauri 初始化 + Vite/React + IPC 通道（spawn_git 跑通）+ 打包出 3MB 安装包 + 命令日志面板 + 主题 | 4-6 天 ✅ **实测安装包 1.19 MiB** |
| M1 | 只读：打开仓库、提交图（Canvas + lane）、diff、状态列表、引用树 | 2.5 周 ✅ **已完成** |
| M2 | 写：hunk 级 stage、提交/amend、分支操作、stash、tag | 2 周 ✅ **已完成** |
| M3 | 远程 + 冲突三层编辑器 + rebase | 3 周 ⏳ **fetch/pull/push + 冲突逐块解决已完成；剩 rebase / cherry-pick / 凭据引导** |
| M4 | 打磨：命令面板、快捷键、搜索、i18n、自动更新、安装包 | 2 周 |
| **合计** | 单人全职约 **12-14 周** 到可日常自用（含 Tauri 迁移的 +25%） | — |

**最先验证的风险点（M1 就要做尖刀验证）**：
1. Linux kernel 仓库（~1.3M commits）滚动是否 60fps → 决定要不要上 WASM/WebGL
2. 行级 stage 在 CRLF + 大文件下的正确性 → 决定方案 5.2 走哪条路
3. `git cat-file --batch` 流式读大 binary 是否卡主线程 → 决定是否强制 Worker

---

## 11. 实施进度

### M0 / M1 / M2 已完成，M3 完成一半

代码已落地在仓库根目录，未编译验证的部分已标注。

| 项 | 状态 | 证据 |
| --- | --- | --- |
| Tauri 2 骨架 + IPC 通道 | ✅ | `src-tauri/src/git_cmd.rs`：`git_probe` / `git_run` / `git_cancel`，argv 数组 + 超时 taskkill + 无控制台窗口 |
| 前端构建 | ✅ | `vite build` 通过：JS 167KB（gzip 54KB）+ CSS 11KB |
| 类型检查 | ✅ | `tsc --noEmit` 零错误（strict） |
| 解析层正确性 | ✅ | `npm run verify` **46/46**，真实 git 造场景（merge/tag/中文路径/冲突三段/CRLF/未跟踪） |
| 提交图泳道 | ✅ | `features/graph/layout.ts` 纯函数 + `drawGraph.ts` Canvas |
| 打开仓库 / 状态 / 引用树 / diff / 命令日志 | ✅ | 见 README 能力表 |
| `cargo build` / release | ✅ | `cargo check` 4m23s 零错误；release 打包成功 |
| NSIS 安装包真实体积 | ✅ | **1.19 MiB**（exe 3.2 MB），Electron 对照 100-170MB |
| 运行内存 | ✅ | 实测工作集 65 MB（对照 Electron ~150MB） |
| 端到端 UI | ✅ | PrintWindow 截图确认：三栏布局、泳道图、徽标、状态分组、diff、命令日志 |

### 验证手段（`npm run verify`，共 154 项断言）

| 脚本 | 项数 | 覆盖 |
| --- | --- | --- |
| `verify-parsers.ts` | 46 | 真实 git 输出 → porcelain v2 / log 格式 / unified diff / 泳道布局 |
| `verify-staging.ts` | 43 | **行级暂存端到端**：`git diff → 选行 → 重建 patch → git apply --cached`，逐场景断言 index 内容 |
| `verify-remote.ts` | 25 | 本地 bare 当 origin：push -u / fetch / pull --ff-only 拒绝分叉 / --force-with-lease 过期拒绝 / rebase |
| `verify-conflict.ts` | 40 | 真实冲突文件 → 逐块决策 → 合成内容；含 diff3 基线段、空侧、无尾换行、`=======` 误判 |

暂存链路里抓到的两个真坑（都已修）：
1. 未选中的 `-` 行必须降级成上下文行，不能直接删。
2. `\ No newline at end of file` 在「删除行被降级」或「老侧无尾换行」时必须特殊处理，否则会把下一行粘上来（实测 `beta` + `gamma` → `betagamma`）。

### 布局重构（按用户反馈，v3）

| 反馈 | 处理 |
| --- | --- |
| 暂存区/工作区/未跟踪应合并成一个列表 | `ChangesPanel`：单列表 + X/Y 双状态色块（`.chip`），行内 +/−/✕，点击后右侧 diff 用「未暂存 / 已暂存」分段切换 |
| 每次都要打开仓库太麻烦 | 工具栏仓库下拉（最近 24 个）+ 无仓库时的「最近打开」首页 + 自动打开上次仓库 |
| 提交历史不显示提交说明 | 真因：中心列 ~520px，泳道图占 266px + 作者/日期/哈希 237px，`subject` 被挤成 0 宽。修法：图区自适应压缩到 ≤156px、中心列加宽、`subject` 设 `min-width:56px`、容器查询在窄列自动隐藏作者/短哈希 |
| 提交面板默认别显示 | `bottomPanel: 'none'｜'commit'｜'log'`，默认 none，Ctrl+K 打开，提交后自动收起 |
| 加工具栏 | `Toolbar`：提交 / 获取 / 拉取 / 推送 / 合并 / 变基 / 更多（强推、全部暂存、stash、日志）/ 分支 pill / remote / 刷新 |

### 对标 SmartGit 18.2.7 的布局（v4）

拿 SmartGit 的实际截图逐块对比后，吸收 4 点、明确不跟 3 点。

**吸收的**

| SmartGit 做法 | 我们的实现 | 为什么值得跟 |
| --- | --- | --- |
| 左栏常驻 Repositories 面板，`name (branch)`，点一下即切换 | `RepoPanel`：仓库列表 + 每个仓库的当前分支（逐个 `rev-parse --abbrev-ref HEAD`，最多 12 个） | 多项目切换从「打开对话框」变成「一次点击」，这正是用户抱怨的点 |
| Files 表用 State 词（Modified/Untracked）+ Relative Directory 分列 | 单列表 + X/Y 双状态色块 + 目录暗色 / 文件名亮色 | 分区意图一致；但双色块能同时表达「已暂存/未暂存」，比单词更精确 |
| Changes 面板左右分栏（HEAD ↔ Working Tree） | `DiffView` 支持 split/unified，默认 split；顶部标出两侧语义（暂存区 ↔ 工作区 / HEAD ↔ 暂存区 / 父提交 ↔ 本次提交） | 分栏是代码审阅的默认姿势；统一视图保留给窄窗口 |
| 底部状态条（Ready / 1 File / 1:1） | `StatusBar`：就绪·进行中 / 仓库路径 / 变更数 / 已暂存 / 冲突 / git 版本 / 日志开关 | 长操作有地方显示进度，不抢占主区域 |
| 大图标 + 文字工具栏，带 ▾ 分组 | 图标 + 文字，分组：拉取▾ 推送▾ ｜ 提交 ｜ 暂存 取消暂存 ｜ 合并▾ 变基▾ ｜ Stash▾ 标签 ｜ 日志 刷新 | 一眼能扫到操作，不用读文字菜单 |

**刻意不跟的**

| SmartGit 做法 | 不跟的理由 |
| --- | --- |
| 顶部菜单栏（Repository / Edit / View / Remote / Local / Branch / Query / Tools / Review / Window / Help，11 个菜单） | Windows 上应该是**原生菜单**（Tauri menu API），而不是在网页里画一排假菜单；等快捷键/命令面板（M4）一起做 |
| 面板可自由拖拽停靠、可关闭、可重排 | 停靠系统（drag target / 布局持久化 / 多窗口）成本远高于收益；固定三栏 + 可折叠已经覆盖 95% 场景 |
| Journal 平铺 log（无泳道图） | 用户明确要「提交图 + 提交说明」，泳道图保留 |
| Index Editor / Investigate / Blame / Git-Flow | 超出当前里程碑；Blame 在 M4 计划内 |

### 布局 v5：三段式主区（按用户反馈）

| 反馈 | 处理 |
| --- | --- |
| 左栏仓库在上、分支在下，分支多了没有滚动条 | 左栏改成上下堆叠（去掉 Tab）；`.side-scroll` 显式 `overflow-y: auto` + `min-height: 0`。实测 63 个分支：`scrollHeight 1978 > clientHeight 671`，滚动条正常 |
| 中间要「变更 / 文件内容 / 提交历史」三段 | `CenterStack`：`grid-template-rows` 三段 + 2 条可拖拽分隔条；选中的变更文件直接反映在中间分栏 diff |
| 文件内容要两列（原内容 / 修改后） | 分栏 diff 成为默认视图；面板标题给出两侧语义（暂存区 ↔ 工作区 / HEAD ↔ 暂存区 / 父提交 ↔ 本次提交） |

顺带修掉两个只有真实数据才会暴露的 bug：

1. **分隔条拖拽状态会卡死**：`mouseup` 丢在窗口外时 `draggingRef` 永远为 true，比例再也不持久化（实测看到 `27.84fr` 这种半截值）。改为拖拽结束即写 localStorage，并加 `window.blur` 兜底。
2. **泳道超过 31 条会被画布裁掉**：原来 `MIN_LANE_STEP = 4.5px` 是死下限，60 条泳道算出 286px 宽，超出 156px 画布后被直接裁掉。改成步长按泳道总数压缩（下限 1.8px），数学上保证 `laneCount × step + 2·PAD ≤ 156`。

### 布局 v6（按用户反馈）

| 反馈 | 处理 |
| --- | --- |
| 左栏和中间的分隔条要能拖，分支名被遮挡 | `.workspace` 改成 `左栏 px ｜ 5px splitter ｜ 1fr`，拖拽实时改宽（190-620px，且不超过窗口 60%），双击复位 300px，宽度持久化。实测 252 → 382px、`localStorage` 同步 |
| 选中历史提交时，上方要加页签显示该提交的文件 | 上方文件区改为页签模型：`工作区` + 每点开一个提交就多一个 `提交 xxxxxxx` 页签（可关，最多 8 个）。页签内是该提交的文件列表，选中 → 中段显示该文件 diff |
| 双击文件弹窗看改动 | `.diff-mask` + `.diff-modal` 全屏弹窗，复用同一份 patches / selection，所以弹窗里也能选中暂存；`Esc` / 点遮罩关闭 |
| 主题不能只有黑色 | 深色 / 浅色 / 跟随系统三档。做法：把散落的 `rgba(255,255,255,.0x)`、`#4f5c6d` 等 30 多个硬编码色收成 `--hover-1/--hover-2/--sel/--dim-1..3/--scroll/--overlay/--primary/--hunk-fg/...` 语义变量，再加一份 `:root[data-theme='light']` 覆盖；canvas 的节点描边读 `--node-ring` 才不会在浅色下留黑边 |

顺带修掉的图问题：

- **泳道图会糊成彩色噪点带**：仓库有 653 个远程分支时 `git log --all` 的泳道数爆炸，步长被压到 1.8px、几十条线重叠。两手处理：
  (1) 提交历史默认范围改为 `--branches HEAD`（本地分支 + HEAD），「历史」下拉里可切回 `--all`；
  (2) 绘制时最多画 22 列，超出的折到最后一列，`laneCount × step + 2·PAD ≤ 156px` 依然成立。

### 布局 v7（按用户反馈）

| 反馈 | 处理 |
| --- | --- |
| 点 stash 也要在上方开页签看文件 | 页签模型抽象成 `CommitTab{kind:'commit'|'stash'}`，key 分别是 sha 与 `stash:stash@{0}`；`activateTab()` 统一加载文件列表与首个文件 diff。stash 的文件用 `git diff <ref>^1 <ref>` 取（stash 是 merge commit，`git show` 会出组合 diff，不能直接用）。单击 = 看内容，行内按钮 = Pop / 应用 / 删除 |
| 浅色主题时最上方标题栏还是黑的 | 那是 **Windows 原生标题栏**。修法：`setTheme` 时调 `getCurrentWindow().setTheme('light'\|'dark'\|null)`，capabilities 加 `core:window:allow-set-theme`，并去掉 tauri.conf 里写死的 `"theme": "Dark"` |
| 远程分支要能检出成本地分支 | 远程分支行支持双击（和行内 ⤓ 按钮），弹窗输入本地名（默认去掉 `origin/` 前缀）；已存在就切换并重设 upstream，不存在就 `git switch -c <name> --track <remote>` |
| 本地/远程要绑定，显示领先/落后次数 | `for-each-ref` 增加 `%(upstream:track)`（放在行尾因为里面含空格），解析成 ahead/behind/gone；分支行显示 `>1` / `<2`，上游被删显示「上游已删」 |

顺带修掉一个隐蔽 bug：分组用 `useState(defaultOpen)`，而数据是异步来的 —— 首次渲染时 count 还是 0，`defaultOpen` 为 false 就再也打不开（Stash/标签分组会一直空着）。改为 `defaultOpen` 变 true 时自动展开一次。

### 布局 v9：自动刷新 / 对比 / 搜索（按用户需求）

| 需求 | 实现 |
| --- | --- |
| IDE 改完不用手动刷 | Rust `notify` 监听工作区 + `.git`，350ms 合并窗口后 emit `repo://changed`；前端 250ms 去抖，`.git` 变化走全量刷新、工作区变化走轻量刷新（只 status+refs） |
| rebase 冲突后没法继续 | 顶部「进行中」横幅 + 继续 / 跳过 / 中止；`GIT_EDITOR=true` 避免 `rebase --continue` 卡在编辑器 |
| 分支↔分支对比 | 一套「任意两个 rev」的实现：`git diff --name-status A B` + `--shortstat` + `rev-list --count A..B`，左右可以是分支/标签/sha/`HEAD~3` |
| 提交 A↔提交 B 对比（中间多次提交） | 同上——`git diff` 与 DAG 关系无关，B 不是 A 的子孙也能对比，标题里额外显示「中间 N 个提交」 |
| 在历史里搜说明 / 搜文件 | `--grep` 固定串 + `-i`；文件模式用 paths 通配 `*关键词*`（代价：不跟重命名，`--follow` 不支持通配） |

测试当场抓到三个 bug（都是"看着对、实际没生效"那类）：

1. `--no-optional-locks` 放错位置 → `git status` 直接失败，UI 显示 0 个变更
2. 搜索的 `--branches` 放在 `--` 之后 → 被当成路径，搜索范围退化成只有 HEAD（已加回归断言：只在未合并分支上的文件也必须能搜到）
3. 监听的忽略规则里有 `/.tmp/`，而仓库本身在 `.../.tmp/demo` → **所有事件被误杀**，表现为"监听成功但永远收不到"。改为相对监听根目录判断

### 布局 v10：CI / 差异导航 / 拣选还原

- **CI**：GitHub Actions 两job（windows-latest）——前端跑 typecheck + 179 项 verify + build；Rust 跑 `cargo check --locked`；README 挂 badge
- **差异块导航**：`n/N` 计数 + 上/下一个按钮，`scrollIntoView({block:'center'})` 定位；换文件/换提交自动回到第 1 块
- **折叠未改动区**：hunk 之间插入「⋯ N 行未改动 ⋯」（`cur.oldStart - (prev.oldStart + prev.oldLines)`）
- **拣选 / 还原**：提交头部两个按钮，`git cherry-pick <sha>` / `git revert --no-edit <sha>`；冲突后由 v9 的「进行中」横幅接管

顺带修掉一个"patch 没生效"的问题：`interactive` 与 `containerRef` 的替换锚点缩进写错了，
导致 stash/compare 视图仍然可点选、差异导航拿不到容器 ref（表现为按钮点了没反应）。
这提醒以后改 JSX 要用 `assert old in s` 校验锚点，不要静默失败。

### 布局 v11：提交历史分页 + 视口绘制

**为什么要顺带改绘制方式**：canvas 位图高度在 Chromium 上有 32767px 硬上限，26px 一行到 1200 多行就画不出来。
所以分页的前提是把画布改成「固定视口大小 + 按 scrollTop 偏移绘制」：

- `.commit-wrap`（position:relative）里放两块：画布（absolute，视口大小）+ 滚动容器（absolute inset:0）
- `drawGraph` 只画 `[scrollTop/ROW_H - 1, (scrollTop+viewport)/ROW_H + 1]` 区间的行
- 分页：`logLimit` 每次 +400 后整段重取（几千行的解析是毫秒级，比增量拼接泳道快照更不容易错）
- 滚到距底 320px 自动续页；底部也有「加载更多（已加载 N 条）」按钮兜底
- 换搜索条件/换仓库时深度重置回 400；普通刷新保留当前深度，不会把用户翻了 3 页的列表缩回去

**顺带修掉一个一直存在的测量 bug**：尺寸测量写在 `useEffect(..., [])` 里，而首帧 `graph` 为空时不渲染
`.commit-scroll`，effect 拿不到节点后再也不会重新测量 → 画布一直停在 canvas 默认的 300×150
（之前看到"选中底色只有 3px 宽"就是这个原因）。改用 ref 回调，节点真正挂载时才测量并观察。

实测（1500 提交的合成仓库）：首屏 400 条 → 点按钮 800 → 滚到底自动 1200；画布始终 333px（不随行数增长），
滚动到第 713 条时泳道图正确重绘。

### 布局 v12：行内差异高亮

`src/patch/word.ts`（纯函数，23 项断言覆盖）：

- `tokenize`：`\s+` | `[A-Za-z0-9_]+` | 单字符标点，三段都保留，能拼回原文
- `diffWords`：token 级 LCS（DP 表 + 回溯），返回两侧分段；超 400 token 直接整行标记，避免 O(n·m)
- 纯空白变化合并进相邻片段 —— 否则"只改了缩进"会把整行点亮，反而干扰
- `buildWordMap(hunk)`：只在 hunk 内相邻的 del/add **块内按位配对**（和分栏对齐规则一致），
  配不上的那一侧不标记，上下文行不入表

渲染侧：`<span class="wd">` 包住变化片段；del 侧红、add 侧绿，浅色主题单独调透明度。
顶部「行内」按钮可关闭（写 localStorage），关掉后回到"整行高亮"。

### v13：凭据弹窗（含一个 GCM 挂死的坑）

**问题**：这台机器 Windows 侧的 git 配了 `credential.helper=helper-selector` → `manager`（GCM）。
从桌面应用调用 `git push` 时，GCM 会开 GUI 登录窗并**一直等**，表现是整条命令挂住、
所有按钮变灰、没有任何提示（实测卡了 8 秒以上才被我们的超时兜住）。

**做法**

1. Rust 侧统一注入 `GCM_INTERACTIVE=never` 与 `-c credential.interactive=never -c credential.guiPrompt=false`，
   有缓存凭据照常使用，没有就快速失败而不是弹窗等待
2. 认证失败（`could not read Username` / `Authentication failed` / `401` / `403` …）时，
   把「要重试的动作」存成闭包，弹出我们自己的凭据框，而不是把英文错误丢给用户
3. 凭据通过 **环境变量 + 一次性 credential helper** 注入：
   `-c credential.helper=`（清空）`-c credential.helper='!f(){ echo username=$GD_USER; echo password=$GD_PASS; }; f'`
   密码只在 env 里，**argv 里没有**，所以命令日志看不到、也不会被「复制命令」带走
4. 勾「记住」→ `git credential approve`（stdin 传协议行），写进系统凭据管理器

**验证**（本地假服务端，不触网）：起一个永远返回 401 的 HTTP 服务当 remote →
应用里点推送 → 弹凭据框（标题带 host）→ 填入后重试，服务端日志收到
`auth=Basic demo-user:demo-token-123`，同时命令日志里只有干净的 `git push origin refs/heads/main`（`leaked: false`）。

### 与初版方案的偏离（有意为之）

| 方案原定 | 实际 | 原因 |
| --- | --- | --- |
| Tailwind + Radix | 手写 CSS 变量（约 900 行） | M0 不引构建期依赖，主题切换已有 CSS 变量支持，后续再换不难 |
| CodeMirror 6 做 diff | 手写 unified 渲染 | 去掉 6 个包，diff 展示只需行级着色；等要做 hunk 选择再引 CM6 |
| Web Worker 算泳道 | 主线程计算 | 400 条提交 < 2ms；M2 上分页后再下沉 Worker |
| `git_stream` 流式接口 | 暂只做 `git_run` | 首屏 400 条一次性返回足够；分页时再加流式 |

### 下一步

1. **大仓库**：提交图分页 + 泳道快照拼接 + `git_stream` 流式接口（当前一次拉 400 条）
2. **rebase 系**：interactive rebase（拖拽排序/squash/reword/drop）、cherry-pick、revert
3. **凭据引导**：目前 `GIT_TERMINAL_PROMPT=0`，缺凭据时给出提示并引导到终端；后续接 Git Credential Manager
4. **diff 体验**：split 视图、word-level 高亮、语法高亮（届时引 CodeMirror 6）
5. **命令面板 + 全局搜索**（`git grep`）

### 安全兜底（已实现）

- 所有丢弃/写 index 前的操作先 `git stash create` + `update-ref refs/gitdesk/backups/<ts>`，
  侧栏「备份」可一键恢复；这些 ref 不会被 gc，也不出现在 `git log --all` 的常规视图里。
- 强制推送只走 `--force-with-lease`，且二次确认。
- `git status`/`git diff` 等只读命令与写命令共用同一个 `runner`，命令日志里能看到全部真实 argv。

---

## 9. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 大仓库提交图卡顿 | 核心体验崩 | 分页 + lane 快照拼接；必要时 lane 计算下沉 WASM；Canvas 脏矩形重绘 |
| hunk 级 stage 边界 bug | **可能损坏用户工作区** | 所有写 index 操作前自动 `git stash create` 快照到 `.git/gitdesk-backup/`，提供一键恢复 |
| 凭据/SSH 配置地狱 | 用户装完连不上远端 | 复用 `git credential fill`，绝不自研；失败时引导到命令行 `git config credential.*` |
| hooks 阻塞（husky/lint-staged） | UI 假死 | 长任务一律可取消 + 进度条显示 stdout 实时流 |
| 破坏性操作误触 | 数据丢失 | force push / hard reset / discard 全部二次确认；force 默认 `--force-with-lease`；reflog 面板可救回 |
| WebView2 缺失（老 Win10/精简系统） | 打不开 | 打包用 `downloadBootstrapper`（+0MB）+ `embedBootstrapper`（+1.8MB）兜底；启动检测并给出下载链接 |
| Rust 工具链与 CI 复杂度上升 | 迭代变慢 | Rust 代码量锁死在 2500 行内；CI 只跑 `cargo check` + 一次 release build；解析逻辑全在 TS 侧可本机调试 |

---

## 10. 需要你拍板的 4 个点

1. ~~壳~~ 已定：**Tauri 2**（安装包 3MB 级，UI 代码不变，Rust 只写外壳）。详见 `docs/SHELL-COMPARISON.md`。
2. **git 来源**：默认用系统 git + 缺失时引导下载 MinGit（安装包 ~3MB），还是内置 MinGit 保证离线开箱即用（安装包 ~40MB）→ 建议前者。
3. **第一阶段砍到多小**：我倾向 M1+M2 一起（能自用），把 M3 的远程/冲突放第二批。若你想更快看到东西，可以只做 M1。
4. **要不要内置三栏合并编辑器**：这是最贵的一块（~1.5 周），也可以先用「接受 ours/theirs + 内置文本编辑器手改」过渡。

确认后我按 M0 → M1 开始搭骨架，先跑通「打开仓库 → 看到提交图 → 点开 diff」这条竖切。
