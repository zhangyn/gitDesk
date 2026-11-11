import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { open as openDirDialog } from '@tauri-apps/plugin-dialog';
import type {
  Commit,
  CommitFile,
  FilePatch,
  ProbeResult,
  RefEntry,
  RepoEntry,
  RepoInfo,
  RepoStatus,
  Side,
  StatusEntry,
} from './types';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { probeGit, runGit, setOneShotAuth, watcherSuppressed } from './git/runner';
import { openRepo } from './git/ops/repo';
import { getStatus } from './git/ops/status';
import {
  getCommitFiles,
  getLog,
  searchLog,
  type LogScope,
  type LogSearch,
} from './git/ops/log';
import {
  compareFileDiff,
  compareFiles,
  compareStat,
  resolveRev,
} from './git/ops/compare';
import { getRefs } from './git/ops/refs';
import { getCommitDiff, getUntrackedDiff, getWorktreeDiff } from './git/ops/diff';
import {
  applyPatchToIndex,
  applyPatchToWorktree,
  discardFileChanges,
  stageAll,
  stageFile,
  unstageAll,
  unstageFile,
} from './git/ops/indexOps';
import { createCommit, getLastCommitMessage, type CommitOptions } from './git/ops/commit';
import {
  cherryPick,
  cherryPickAbort,
  cherryPickContinue,
  createBranch,
  createTrackingBranch,
  deleteBranch,
  getOngoingOperation,
  mergeBranch,
  rebaseAbort,
  rebaseContinue,
  rebaseOnto,
  rebaseSkip,
  revertAbort,
  revertCommit,
  revertContinue,
  switchBranch,
} from './git/ops/branch';
import {
  applyStash,
  createBackup,
  dropStash,
  listBackups,
  listStashes,
  restoreBackup,
  saveStash,
  type BackupEntry,
  type StashEntry,
} from './git/ops/stash';
import { createTag, deleteTag } from './git/ops/tag';
import { stashFileDiff, stashFiles } from './git/ops/stash';
import {
  approveCredentials,
  fetchRemote,
  humanizeRemoteError,
  isAuthError,
  listRemotes,
  parseRemoteUrl,
  pullRemote,
  pushRemote,
  type RemoteInfo,
} from './git/ops/remote';
import {
  abortMerge,
  checkoutSide,
  loadConflictSides,
  markResolved,
  writeResolvedFile,
  type ConflictSides,
} from './git/ops/conflict';
import {
  parseConflictFile,
  resolveConflict,
  undecidedCount,
  type Decision,
} from './conflict/parse';
import { layoutGraph, type GraphRow } from './features/graph/layout';
import { buildSelectedPatch } from './patch/build';
import { confirmBox } from './ui/dialog';
import { applyTheme, loadTheme, syncWindowTheme, watchSystemTheme } from './ui/theme';

const RECENT_KEY = 'gitdesk.recent';
/** 每页加载多少条提交；点「加载更多」就再加一页 */
const LOG_PAGE = 400;
const MAX_RECENT = 24;

export interface DiffTarget {
  kind: 'commit' | 'file' | 'stash' | 'compare';
  path: string;
  sha?: string;
  /** stash 视图：stash@{n} */
  ref?: string;
  /** compare 视图：解析后的两个 sha */
  a?: string;
  b?: string;
}

export type TabKind = 'commit' | 'stash' | 'compare';

export interface CommitTab {
  kind: TabKind;
  /** commit: sha；stash: `stash:stash@{0}`；compare: `compare:a...b` */
  key: string;
  label: string;
  subject: string;
  /** compare 专用的两个原始 rev（可能是分支名） */
  a?: string;
  b?: string;
}

export interface CompareInfo {
  aSha: string;
  bSha: string;
  /** A..B 之间的提交数 */
  commitCount: number;
  insertions: number;
  deletions: number;
}

/** 页签 key → stash ref */
export function stashRefOfKey(key: string): string {
  return key.startsWith('stash:') ? key.slice('stash:'.length) : key;
}

/** 上方文件区的页签：worktree = 当前工作区，其它值是提交 sha */
export type FileTabKey = 'worktree' | string;

export type Theme = 'dark' | 'light' | 'system';

export type BottomPanel = 'none' | 'commit' | 'log';

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
}

function loadRecent(): RepoEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as RepoEntry[];
    if (!Array.isArray(list)) return [];
    return list.filter((r) => r && typeof r.path === 'string' && typeof r.name === 'string');
  } catch {
    return [];
  }
}

function saveRecent(list: RepoEntry[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    /* 配额/隐私模式下静默失败 */
  }
}

function pickSide(worktree: FilePatch[], staged: FilePatch[]): Side {
  if (worktree.length > 0) return 'worktree';
  return staged.length > 0 ? 'staged' : 'worktree';
}

function hasWorktree(entry: StatusEntry): boolean {
  return entry.kind === 'untracked' || entry.worktree !== '.';
}

function hasStaged(entry: StatusEntry): boolean {
  return entry.kind !== 'untracked' && entry.index !== '.';
}

interface AppStore {
  booted: boolean;
  git: ProbeResult | null;
  busy: string | null;
  error: string | null;

  repo: RepoInfo | null;
  recent: RepoEntry[];
  /** 每个最近仓库的当前分支（用于左栏显示 name (branch)） */
  repoBranches: Record<string, string>;

  status: RepoStatus | null;
  refs: RefEntry[];
  commits: Commit[];
  graph: GraphRow[];
  stashes: StashEntry[];
  backups: BackupEntry[];
  ongoing: string | null;
  remotes: RemoteInfo[];
  remote: string;

  selectedSha: string | null;
  commitFiles: CommitFile[];

  /** 提交历史的范围：local = 本地分支+HEAD，all = 含远程 */
  logScope: LogScope;
  setLogScope: (scope: LogScope) => void;
  /** 提交历史搜索（null = 不过滤） */
  logQuery: LogSearch | null;
  logSearching: boolean;
  /** 行内差异高亮开关 */
  wordDiff: boolean;
  toggleWordDiff: () => void;
  /** 当前加载深度（每次「加载更多」+LOG_PAGE） */
  logLimit: number;
  loadMoreLog: () => Promise<void>;
  setLogQuery: (mode: 'message' | 'path', text: string) => void;
  clearLogQuery: () => void;
  /** 对比视图的元信息 */
  compareInfo: CompareInfo | null;
  /** 远端认证失败时弹出的凭据请求（null = 不显示） */
  credRequest: { label: string } | null;
  askCredentials: (label: string, retry: () => Promise<void>) => void;
  submitCredentials: (user: string, pass: string, remember: boolean) => Promise<void>;
  cancelCredentials: () => void;
  /** 暂存区统计（提交面板用） */
  stagedStat: { files: number; insertions: number; deletions: number } | null;
  /** 上方文件区的页签集合与当前页签 */
  commitTabs: CommitTab[];
  fileTab: FileTabKey;
  /** 双击文件打开的大窗 diff */
  diffModal: boolean;
  theme: Theme;

  target: DiffTarget | null;
  worktreePatches: FilePatch[];
  stagedPatches: FilePatch[];
  side: Side;
  patches: FilePatch[];
  selection: Set<string>;
  conflictSides: ConflictSides | null;
  decisions: Record<number, Decision>;
  diffLoading: boolean;

  bottomPanel: BottomPanel;

  boot: () => Promise<void>;
  pickRepo: () => Promise<void>;
  openPath: (path: string) => Promise<void>;
  closeRepo: () => void;
  removeRecent: (path: string) => void;
  refreshRepoBranches: () => Promise<void>;
  refresh: () => Promise<void>;
  /** 只刷新变更与引用（文件监听触发，轻量） */
  refreshLight: () => Promise<void>;
  clearError: () => void;

  openCommit: (sha: string) => Promise<void>;
  openStash: (ref: string) => Promise<void>;
  openCompare: (a: string, b: string) => Promise<void>;
  closeCommitTab: (key: string) => Promise<void>;
  setFileTab: (key: FileTabKey) => Promise<void>;
  showTabFile: (file: CommitFile) => Promise<void>;
  createTrackingBranchOp: (localName: string, remoteRef: string) => Promise<void>;
  openDiffModal: () => void;
  closeDiffModal: () => void;
  setTheme: (theme: Theme) => void;
  showChange: (entry: StatusEntry) => Promise<void>;
  setSide: (side: Side) => void;

  toggleKeys: (keys: string[]) => void;
  clearSelection: () => void;

  stageSelection: () => Promise<void>;
  unstageSelection: () => Promise<void>;
  /** 按指定的行 key 集合暂存/取消暂存（差异块上的「暂存此块」用它） */
  stageKeys: (keys: string[], undo: boolean) => Promise<void>;
  discardSelection: () => Promise<void>;
  stageEntry: (entry: StatusEntry) => Promise<void>;
  unstageEntry: (entry: StatusEntry) => Promise<void>;
  discardEntry: (entry: StatusEntry) => Promise<void>;
  stageAllOp: () => Promise<void>;
  unstageAllOp: () => Promise<void>;

  setDecision: (blockId: number, decision: Decision) => void;
  decideAll: (decision: Decision) => void;
  applyResolved: () => Promise<void>;
  checkoutSideOp: (path: string, side: 'ours' | 'theirs') => Promise<void>;
  abortMergeOp: () => Promise<void>;
  /** 中断后的后续动作：rebase / cherry-pick / revert */
  /** 把某个提交拣选到当前分支（-x 不记录来源，保持简单） */
  cherryPickOp: (sha: string) => Promise<void>;
  /** 生成反向提交 */
  revertOp: (sha: string) => Promise<void>;
  continueOp: () => Promise<void>;
  skipOp: () => Promise<void>;
  abortOp: () => Promise<void>;

  lastCommitMessage: () => Promise<string>;
  doCommit: (opts: CommitOptions) => Promise<boolean>;
  setBottomPanel: (p: BottomPanel) => void;

  createBranchOp: (name: string) => Promise<void>;
  switchBranchOp: (name: string) => Promise<void>;
  deleteBranchOp: (name: string) => Promise<void>;
  mergeBranchOp: (name: string) => Promise<void>;
  rebaseOntoOp: (name: string) => Promise<void>;

  stashSaveOp: (message: string) => Promise<void>;
  stashApplyOp: (ref: string, drop: boolean) => Promise<void>;
  stashDropOp: (ref: string) => Promise<void>;

  createTagOp: (name: string, message: string) => Promise<void>;
  deleteTagOp: (name: string) => Promise<void>;

  restoreBackupOp: (sha: string) => Promise<void>;

  setRemote: (name: string) => void;
  fetchOp: () => Promise<void>;
  pullOp: (strategy: 'ff-only' | 'rebase' | 'merge') => Promise<void>;
  pushOp: (force: boolean) => Promise<void>;
}

const EMPTY_REPO_STATE = {
  status: null,
  refs: [] as RefEntry[],
  commits: [] as Commit[],
  graph: [] as GraphRow[],
  stashes: [] as StashEntry[],
  backups: [] as BackupEntry[],
  ongoing: null,
  remotes: [] as RemoteInfo[],
  remote: 'origin',
  selectedSha: null,
  commitFiles: [] as CommitFile[],
  logScope: 'local' as LogScope,
  logQuery: null,
  logSearching: false,
  logLimit: LOG_PAGE,
  wordDiff: localStorage.getItem('gitdesk.wordDiff') !== '0',
  compareInfo: null,
  credRequest: null,
  stagedStat: null,
  commitTabs: [] as CommitTab[],
  fileTab: 'worktree' as FileTabKey,
  diffModal: false,
  target: null,
  worktreePatches: [] as FilePatch[],
  stagedPatches: [] as FilePatch[],
  side: 'worktree' as Side,
  patches: [] as FilePatch[],
  selection: new Set<string>(),
  conflictSides: null,
  decisions: {} as Record<number, Decision>,
  diffLoading: false,
};

/* --------------------------------------------------------------- 凭据请求 */

/** 认证失败后要重试的那个动作（存在闭包里，不进 state 免得被序列化/比对） */
let pendingRetry: (() => Promise<void>) | null = null;

/* --------------------------------------------------------------- 文件监听 */

let unlistenChanged: UnlistenFn | null = null;
let watchTimer: ReturnType<typeof setTimeout> | null = null;

/** 开始监听仓库：磁盘一变就让 UI 自己跟上，不用手动 F5 */
async function startWatch(path: string): Promise<void> {
  try {
    await invoke('watch_repo', { path });
  } catch {
    return; // 监听失败不影响正常使用
  }
  if (unlistenChanged) return;
  unlistenChanged = await listen<{ scope?: string }>('repo://changed', (ev) => {
    // 我们自己刚跑过写命令，那边的 reload 会负责刷新
    if (watcherSuppressed()) return;
    const scope = ev.payload?.scope ?? 'worktree';
    if (watchTimer) clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      const st = useStore.getState();
      if (!st.repo) return;
      // .git 内部变了（切分支/提交/合并）→ 全量刷；只是工作区文件改了 → 轻量刷
      if (scope === 'git') void st.refresh();
      else void st.refreshLight();
    }, 250);
  });
}

function stopWatch(): void {
  if (watchTimer) {
    clearTimeout(watchTimer);
    watchTimer = null;
  }
  void invoke('unwatch_repo').catch(() => {});
}

export const useStore = create<AppStore>()((set, get) => {
  function getRepoPath(): string {
    const repo = get().repo;
    if (!repo) throw new Error('没有打开仓库');
    return repo.path;
  }

  /** 统一的写操作包装：backup → 执行 → 刷新 → 重载当前 diff */
  async function mutate(
    label: string,
    backup: boolean,
    fn: () => Promise<void>,
  ): Promise<boolean> {
    const repo = get().repo;
    if (!repo) return false;
    set({ busy: label, error: null });
    try {
      if (backup) await createBackup(repo.path, label);
      await fn();
      await reload();
      return true;
    } catch (e) {
      set({ error: errMsg(e) });
      return false;
    } finally {
      set({ busy: null });
    }
  }

  /** 刷新数据并尽量保持当前 diff 视角 */
  async function reload(): Promise<void> {
    await get().refresh();
    const target = get().target;
    if (!target || target.kind === 'commit') return;

    if (get().conflictSides) {
      // 冲突文件：重新读冲突段
      try {
        const sides = await loadConflictSides(getRepoPath(), target.path);
        set({ conflictSides: sides });
        if (!sides.hasMarkers) set({ decisions: {} });
      } catch {
        set({ conflictSides: null });
      }
      return;
    }

    const entry = get().status?.entries.find((e) => e.path === target.path);
    if (!entry) {
      set({ target: null, patches: [], worktreePatches: [], stagedPatches: [] });
      return;
    }
    await loadFileDiff(entry, false);
  }

  /** 打开/激活一个页签（commit 或 stash），并加载它的文件列表与首个文件 diff */
  async function activateTab(tab: CommitTab): Promise<void> {
    const repo = get().repo;
    if (!repo) return;
    const tabs = get().commitTabs.some((t) => t.key === tab.key)
      ? get().commitTabs
      : [...get().commitTabs, tab].slice(-8);

    set({
      commitTabs: tabs,
      fileTab: tab.key,
      selectedSha: tab.kind === 'commit' ? tab.key : get().selectedSha,
      commitFiles: [],
      target: null,
      conflictSides: null,
      worktreePatches: [],
      stagedPatches: [],
      patches: [],
      selection: new Set<string>(),
      diffLoading: true,
    });

    try {
      if (tab.kind === 'compare') {
        const a = tab.a ?? '';
        const b = tab.b ?? '';
        const res = await compareFiles(repo.path, a, b);
        const stat = await compareStat(repo.path, res.aSha, res.bSha);
        set({
          commitFiles: res.files,
          compareInfo: {
            aSha: res.aSha,
            bSha: res.bSha,
            commitCount: res.commitCount,
            insertions: stat.insertions,
            deletions: stat.deletions,
          },
        });
        if (res.files.length > 0) {
          const first = res.files[0];
          const patches = await compareFileDiff(repo.path, res.aSha, res.bSha, first.path);
          set({
            patches,
            worktreePatches: patches,
            stagedPatches: [],
            side: 'worktree',
            target: { kind: 'compare', a: res.aSha, b: res.bSha, path: first.path },
          });
        }
        return;
      }

      const files =
        tab.kind === 'stash'
          ? await stashFiles(repo.path, stashRefOfKey(tab.key))
          : await getCommitFiles(repo.path, tab.key);
      set({ commitFiles: files, compareInfo: null });
      if (files.length > 0) {
        const first = files[0];
        const patches =
          tab.kind === 'stash'
            ? await stashFileDiff(repo.path, stashRefOfKey(tab.key), first.path)
            : await getCommitDiff(repo.path, tab.key, first.path);
        set({
          patches,
          worktreePatches: patches,
          stagedPatches: [],
          side: 'worktree',
          target:
            tab.kind === 'stash'
              ? { kind: 'stash', ref: stashRefOfKey(tab.key), path: first.path }
              : { kind: 'commit', sha: tab.key, path: first.path },
        });
      }
    } catch (e) {
      set({ error: errMsg(e) });
    } finally {
      set({ diffLoading: false });
    }
  }

  async function loadFileDiff(entry: StatusEntry, resetSide: boolean): Promise<void> {
    const repoPath = getRepoPath();
    const prevSide = get().side;
    set({ diffLoading: true, selection: new Set<string>() });
    try {
      const [worktree, staged] = await Promise.all([
        entry.kind === 'untracked'
          ? getUntrackedDiff(repoPath, entry.path)
          : hasWorktree(entry)
            ? getWorktreeDiff(repoPath, entry.path, false)
            : Promise.resolve([] as FilePatch[]),
        hasStaged(entry) ? getWorktreeDiff(repoPath, entry.path, true) : Promise.resolve([]),
      ]);

      const side = resetSide
        ? pickSide(worktree, staged)
        : prevSide === 'staged' && staged.length > 0
          ? 'staged'
          : prevSide === 'worktree' && worktree.length > 0
            ? 'worktree'
            : pickSide(worktree, staged);

      set({
        worktreePatches: worktree,
        stagedPatches: staged,
        side,
        patches: side === 'staged' ? staged : worktree,
        target: { kind: 'file', path: entry.path },
        conflictSides: null,
      });
    } catch (e) {
      set({ error: errMsg(e) });
    } finally {
      set({ diffLoading: false });
    }
  }

  return {
    booted: false,
    git: null,
    busy: null,
    error: null,
    repo: null,
    recent: loadRecent(),
    repoBranches: {},
    ...EMPTY_REPO_STATE,
    bottomPanel: 'none',
    theme: loadTheme(),

    async boot() {
      if (get().booted) return;
      set({ booted: true });
      applyTheme(get().theme);
      void syncWindowTheme(get().theme);
      watchSystemTheme(() => {
        if (get().theme === 'system') {
          applyTheme('system');
          void syncWindowTheme('system');
        }
      });
      try {
        const info = await probeGit();
        set({ git: info });
        if (!info.found) {
          set({ error: '未找到 git。请安装 Git for Windows，并确认 git 在 PATH 中。' });
          return;
        }
        const cliRepo = await invoke<string | null>('startup_repo').catch(() => null);
        const first = get().recent[0]?.path;
        const initial = cliRepo ?? first ?? null;
        if (initial) await get().openPath(initial);
      } catch (e) {
        set({ error: `初始化失败：${errMsg(e)}` });
      }
    },

    async pickRepo() {
      try {
        const dir = await openDirDialog({
          directory: true,
          multiple: false,
          title: '选择 Git 仓库目录',
        });
        if (typeof dir === 'string' && dir.length > 0) await get().openPath(dir);
      } catch (e) {
        set({ error: errMsg(e) });
      }
    },

    async openPath(path) {
      set({ busy: '打开仓库…', error: null, ...EMPTY_REPO_STATE });
      try {
        const repo = await openRepo(path);
        const recent = [
          { path: repo.path, name: repo.name, openedAt: Date.now() },
          ...get().recent.filter((r) => r.path !== repo.path),
        ].slice(0, MAX_RECENT);
        saveRecent(recent);
        set({ repo, recent, bottomPanel: 'none' });
        await startWatch(repo.path);
        await get().refresh();
      } catch (e) {
        set({ error: errMsg(e), repo: null });
      } finally {
        set({ busy: null });
      }
    },

    closeRepo() {
      stopWatch();
      set({ repo: null, ...EMPTY_REPO_STATE, bottomPanel: 'none' });
    },

    removeRecent(path) {
      const recent = get().recent.filter((r) => r.path !== path);
      saveRecent(recent);
      set({ recent });
    },

    /** 逐个仓库读当前分支：`name (branch)` 这样显示才像 SmartGit */
    async refreshRepoBranches() {
      const list = get().recent.slice(0, 12);
      const entries = await Promise.all(
        list.map(async (r) => {
          const res = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd: r.path,
            quiet: true,
            timeoutMs: 8000,
          });
          if (res.code !== 0) return null;
          const head = res.stdout.trim();
          return [r.path, head && head !== 'HEAD' ? head : 'detached'] as const;
        }),
      );
      const map: Record<string, string> = {};
      for (const e of entries) if (e) map[e[0]] = e[1];
      set({ repoBranches: map });
    },

    async refresh() {
      const repo = get().repo;
      if (!repo) return;
      set({ busy: '刷新…', error: null });
      try {
        const search = get().logQuery;
        const [status, commits, refs, stashes, backups, ongoing, remotes, stat] =
          await Promise.all([
            getStatus(repo.path),
            search && search.text.trim()
              ? searchLog(repo.path, get().logLimit, search, get().logScope)
              : getLog(repo.path, get().logLimit, get().logScope),
            getRefs(repo.path),
            listStashes(repo.path),
            listBackups(repo.path),
            getOngoingOperation(repo.path),
            listRemotes(repo.path),
            runGit(['diff', '--cached', '--shortstat'], {
              cwd: repo.path,
              quiet: true,
              timeoutMs: 30_000,
            }),
          ]);
        const statText = stat.stdout.trim();
        const statFiles = /(\d+) file/.exec(statText);
        const statIns = /(\d+) insertion/.exec(statText);
        const statDel = /(\d+) deletion/.exec(statText);
        set({
          stagedStat: {
            files: statFiles ? Number(statFiles[1]) : 0,
            insertions: statIns ? Number(statIns[1]) : 0,
            deletions: statDel ? Number(statDel[1]) : 0,
          },
        });
        const remote =
          remotes.find((r) => r.name === get().remote)?.name ??
          remotes.find((r) => r.name === 'origin')?.name ??
          remotes[0]?.name ??
          'origin';
        set({
          status,
          commits,
          refs,
          stashes,
          backups,
          ongoing,
          remotes,
          remote,
          graph: layoutGraph(commits),
        });

        const current = get().selectedSha;
        if (!current || !commits.some((c) => c.sha === current)) {
          set({ selectedSha: commits[0]?.sha ?? null });
        }

        // 页签合法性：已消失的提交要清理掉
        const tabs = get().commitTabs.filter((t) =>
          t.kind === 'stash'
            ? stashes.some((s) => `stash:${s.ref}` === t.key)
            : t.kind === 'compare'
              ? true
              : commits.some((c) => c.sha === t.key),
        );
        let tab = get().fileTab;
        if (tab !== 'worktree' && !tabs.some((t) => t.key === tab)) tab = 'worktree';
        if (tabs.length !== get().commitTabs.length || tab !== get().fileTab) {
          set({ commitTabs: tabs, fileTab: tab });
        }

        // 工作区页签：默认选中第一个改动，打开就能看到在改什么
        if (tab === 'worktree' && get().target === null) {
          if (status.entries.length > 0) await get().showChange(status.entries[0]);
          else set({ selectedSha: get().selectedSha ?? commits[0]?.sha ?? null });
        }
      } catch (e) {
        set({ error: errMsg(e) });
      } finally {
        set({ busy: null });
      }
    },

    /** 只刷变更与引用：文件监听触发时用，不重拉日志、不动当前 diff */
    async refreshLight() {
      const repo = get().repo;
      if (!repo) return;
      if (get().busy) return; // 别打断正在进行的操作
      try {
        const [status, refs] = await Promise.all([getStatus(repo.path), getRefs(repo.path)]);
        set({ status, refs });
        const t = get().target;
        if (t && t.kind === 'file' && !status.entries.some((e) => e.path === t.path)) {
          set({ target: null, patches: [], worktreePatches: [], stagedPatches: [] });
        }
      } catch {
        /* 文件正在被写时 status 可能瞬时失败，忽略 */
      }
    },

    clearError() {
      set({ error: null });
    },

    setLogQuery(mode, text) {
      // 换搜索条件就回到第一页
      set({
        logQuery: text.trim() ? { mode, text } : null,
        logSearching: Boolean(text.trim()),
        logLimit: LOG_PAGE,
  wordDiff: localStorage.getItem('gitdesk.wordDiff') !== '0',
      });
      void get().refresh();
    },

    clearLogQuery() {
      set({ logQuery: null, logSearching: false, logLimit: LOG_PAGE });
      void get().refresh();
    },

    toggleWordDiff() {
      const next = !get().wordDiff;
      localStorage.setItem('gitdesk.wordDiff', next ? '1' : '0');
      set({ wordDiff: next });
    },

    /** 加载下一页：加大深度后整段重取（几千行的解析是毫秒级，比增量拼接更不容易错） */
    async loadMoreLog() {
      set({ logLimit: get().logLimit + LOG_PAGE });
      await get().refresh();
    },

    async openCommit(sha) {
      const commit = get().commits.find((c) => c.sha === sha);
      await activateTab({
        kind: 'commit',
        key: sha,
        label: `提交 ${sha.slice(0, 7)}`,
        subject: commit?.subject ?? sha.slice(0, 8),
      });
    },

    async openCompare(a, b) {
      const repo = get().repo;
      if (!repo) return;
      // 先校验，避免用户看到空标签页却不知道错在哪
      const [aSha, bSha] = await Promise.all([resolveRev(repo.path, a), resolveRev(repo.path, b)]);
      if (!aSha || !bSha) {
        set({ error: !aSha ? `无法解析左侧版本：${a}` : `无法解析右侧版本：${b}` });
        return;
      }
      const short = (s: string) => s.slice(0, 7);
      await activateTab({
        kind: 'compare',
        key: `compare:${aSha}...${bSha}`,
        label: `${short(aSha)} ↔ ${short(bSha)}`,
        subject: `${a} ↔ ${b}`,
        a,
        b,
      });
    },

    async openStash(ref) {
      const entry = get().stashes.find((s) => s.ref === ref);
      await activateTab({
        kind: 'stash',
        key: `stash:${ref}`,
        label: ref,
        subject: entry?.subject ?? ref,
      });
    },

    async closeCommitTab(key) {
      const tabs = get().commitTabs.filter((t) => t.key !== key);
      const wasActive = get().fileTab === key;
      set({ commitTabs: tabs });
      if (!wasActive) return;
      const next = tabs[tabs.length - 1];
      if (next) await get().setFileTab(next.key);
      else await get().setFileTab('worktree');
    },

    async setFileTab(key) {
      if (key === 'worktree') {
        set({ fileTab: 'worktree' });
        const entry = get().status?.entries[0];
        if (entry) await get().showChange(entry);
        else
          set({
            target: null,
            patches: [],
            worktreePatches: [],
            stagedPatches: [],
            conflictSides: null,
            selection: new Set<string>(),
          });
        return;
      }
      const tab = get().commitTabs.find((t) => t.key === key);
      if (!tab) return;
      if (tab.kind === 'stash') await get().openStash(stashRefOfKey(key));
      else if (tab.kind === 'compare') await get().openCompare(tab.a ?? '', tab.b ?? '');
      else await get().openCommit(key);
    },

    setLogScope(scope) {
      set({ logScope: scope });
      void get().refresh();
    },

    openDiffModal() {
      if (get().target) set({ diffModal: true });
    },

    closeDiffModal() {
      set({ diffModal: false });
    },

    setTheme(theme) {
      set({ theme });
      applyTheme(theme);
      void syncWindowTheme(theme);
    },

    async showTabFile(file) {
      const repo = get().repo;
      if (!repo) return;
      const tab = get().commitTabs.find((t) => t.key === get().fileTab);
      if (!tab) return;
      const isStash = tab.kind === 'stash';
      const isCompare = tab.kind === 'compare';
      const ref = stashRefOfKey(tab.key);
      const cmp = get().compareInfo;
      if (isCompare && !cmp) return;
      set({
        target: isStash
          ? { kind: 'stash', ref, path: file.path }
          : isCompare
            ? { kind: 'compare', a: cmp!.aSha, b: cmp!.bSha, path: file.path }
            : { kind: 'commit', sha: tab.key, path: file.path },
        patches: [],
        worktreePatches: [],
        stagedPatches: [],
        selection: new Set<string>(),
        diffLoading: true,
      });
      try {
        const patches = isStash
          ? await stashFileDiff(repo.path, ref, file.path)
          : isCompare
            ? await compareFileDiff(repo.path, cmp!.aSha, cmp!.bSha, file.path)
            : await getCommitDiff(repo.path, tab.key, file.path);
        set({ patches, worktreePatches: patches });
      } catch (e) {
        set({ error: errMsg(e) });
      } finally {
        set({ diffLoading: false });
      }
    },

    async showChange(entry) {
      const repo = get().repo;
      if (!repo) return;
      if (get().fileTab !== 'worktree') set({ fileTab: 'worktree' });
      if (entry.kind === 'unmerged') {
        set({
          target: { kind: 'file', path: entry.path },
          conflictSides: null,
          decisions: {},
          worktreePatches: [],
          stagedPatches: [],
          patches: [],
          selection: new Set<string>(),
          diffLoading: true,
        });
        try {
          const sides = await loadConflictSides(repo.path, entry.path);
          set({ conflictSides: sides });
        } catch (e) {
          set({ error: errMsg(e) });
        } finally {
          set({ diffLoading: false });
        }
        return;
      }
      await loadFileDiff(entry, true);
    },

    setSide(side) {
      const { worktreePatches, stagedPatches } = get();
      set({
        side,
        patches: side === 'staged' ? stagedPatches : worktreePatches,
        selection: new Set<string>(),
      });
    },

    toggleKeys(keys) {
      if (keys.length === 0) return;
      const next = new Set(get().selection);
      const allIn = keys.every((k) => next.has(k));
      for (const k of keys) {
        if (allIn) next.delete(k);
        else next.add(k);
      }
      set({ selection: next });
    },

    clearSelection() {
      set({ selection: new Set<string>() });
    },

    async stageSelection() {
      const { patches, selection, side } = get();
      const { patch, count } = buildSelectedPatch(patches, selection, side);
      if (count === 0) return;
      await mutate(`暂存 ${count} 行`, false, () => applyPatchToIndex(getRepoPath(), patch, false));
    },

    async stageKeys(keys, undo) {
      const { patches, side } = get();
      if (keys.length === 0) return;
      const subset = new Set(keys);
      const { patch, count } = buildSelectedPatch(patches, subset, side);
      if (count === 0) return;
      await mutate(
        undo ? `取消暂存 ${count} 行` : `暂存 ${count} 行`,
        false,
        () => applyPatchToIndex(getRepoPath(), patch, undo),
      );
    },

    async unstageSelection() {
      const { patches, selection, side } = get();
      const { patch, count } = buildSelectedPatch(patches, selection, side);
      if (count === 0) return;
      await mutate(`取消暂存 ${count} 行`, false, () =>
        applyPatchToIndex(getRepoPath(), patch, true),
      );
    },

    async discardSelection() {
      const { patches, selection, side } = get();
      const { patch, count } = buildSelectedPatch(patches, selection, side);
      if (count === 0) return;
      const ok = await confirmBox({
        title: `丢弃 ${count} 行改动？`,
        body: '这些改动会从工作区移除。操作前会自动创建备份（侧栏「备份」可恢复）。',
        okText: '丢弃',
        danger: true,
      });
      if (!ok) return;
      await mutate('丢弃改动', true, () => applyPatchToWorktree(getRepoPath(), patch, true));
    },

    async stageEntry(entry) {
      await mutate(`暂存 ${entry.path}`, false, () => stageFile(getRepoPath(), entry.path));
    },

    async unstageEntry(entry) {
      await mutate(`取消暂存 ${entry.path}`, false, () => unstageFile(getRepoPath(), entry.path));
    },

    async discardEntry(entry) {
      const isUntracked = entry.kind === 'untracked';
      const ok = await confirmBox({
        title: isUntracked ? `删除未跟踪文件「${entry.path}」？` : `丢弃「${entry.path}」的改动？`,
        body: isUntracked
          ? '文件会被直接删除，不进回收站。'
          : '工作区改动会丢失（暂存区内容保留）。操作前会自动创建备份。',
        okText: '丢弃',
        danger: true,
      });
      if (!ok) return;
      await mutate('丢弃文件改动', !isUntracked, () =>
        discardFileChanges(getRepoPath(), entry.path, isUntracked),
      );
    },

    async stageAllOp() {
      await mutate('暂存全部', false, () => stageAll(getRepoPath()));
    },

    async unstageAllOp() {
      await mutate('取消暂存全部', false, () => unstageAll(getRepoPath()));
    },

    setDecision(blockId, decision) {
      set({ decisions: { ...get().decisions, [blockId]: decision } });
    },

    decideAll(decision) {
      const sides = get().conflictSides;
      if (!sides) return;
      const parsed = parseConflictFile(sides.merged);
      const next: Record<number, Decision> = {};
      for (const c of parsed.conflicts) next[c.id] = decision;
      set({ decisions: next });
    },

    async applyResolved() {
      const repo = get().repo;
      const target = get().target;
      const sides = get().conflictSides;
      if (!repo || !target || !sides) return;

      const parsed = parseConflictFile(sides.merged);
      const open = undecidedCount(parsed, get().decisions);
      if (open > 0) {
        set({ error: `还有 ${open} 个冲突块没有处理。` });
        return;
      }
      const content =
        parsed.conflicts.length > 0 ? resolveConflict(parsed, get().decisions) : sides.merged;
      await mutate('写入解决结果', true, async () => {
        await writeResolvedFile(repo.path, target.path, content);
        await markResolved(repo.path, target.path);
      });
      set({ conflictSides: null, decisions: {} });
    },

    async checkoutSideOp(path, side) {
      const ok = await confirmBox({
        title: `整文件采用${side === 'ours' ? '我方' : '对方'}？`,
        body: '会丢弃该文件另一侧的修改，并直接标记为已解决。',
        okText: '采用',
        danger: true,
      });
      if (!ok) return;
      await mutate('采用一侧', true, () => checkoutSide(getRepoPath(), path, side));
      set({ conflictSides: null, decisions: {} });
    },

    async abortMergeOp() {
      const ok = await confirmBox({
        title: '中止这次合并？',
        body: '会回到合并前的状态，本次冲突处理全部丢弃。',
        okText: '中止合并',
        danger: true,
      });
      if (!ok) return;
      await mutate('中止合并', false, async () => {
        const res = await abortMerge(getRepoPath());
        if (res.code !== 0) throw new Error(res.stderr.trim() || 'merge --abort 失败');
      });
      set({ conflictSides: null, decisions: {} });
    },

    async cherryPickOp(sha) {
      await mutate('拣选提交', true, async () => {
        const res = await cherryPick(getRepoPath(), sha);
        if (res.code !== 0) {
          const msg = res.stderr.trim() || res.stdout.trim();
          if (/conflict/i.test(msg)) {
            await get().refresh();
            throw new Error(`${msg}\n\n有冲突，请在「变更」里解决后点顶部的「继续」。`);
          }
          throw new Error(msg || '拣选失败');
        }
      });
    },

    async revertOp(sha) {
      const ok = await confirmBox({
        title: `还原提交 ${sha.slice(0, 7)}？`,
        body: '会生成一个新的「反向提交」来抵消它的改动，不改写已有历史。',
        okText: '还原',
        danger: true,
      });
      if (!ok) return;
      await mutate('还原提交', true, async () => {
        const res = await revertCommit(getRepoPath(), sha);
        if (res.code !== 0) {
          const msg = res.stderr.trim() || res.stdout.trim();
          if (/conflict/i.test(msg)) {
            await get().refresh();
            throw new Error(`${msg}\n\n有冲突，请在「变更」里解决后点顶部的「继续」。`);
          }
          throw new Error(msg || '还原失败');
        }
      });
    },

    async continueOp() {
      const op = get().ongoing;
      if (!op) return;
      await mutate(`继续 ${op}`, false, async () => {
        const repo = getRepoPath();
        const res =
          op === 'rebase'
            ? await rebaseContinue(repo)
            : op === 'cherry-pick'
              ? await cherryPickContinue(repo)
              : await revertContinue(repo);
        if (res.code !== 0) throw new Error(res.stderr.trim() || `${op} --continue 失败`);
      });
    },

    async skipOp() {
      const op = get().ongoing;
      if (!op) return;
      await mutate(`跳过当前提交`, false, async () => {
        const repo = getRepoPath();
        const res = op === 'rebase' ? await rebaseSkip(repo) : await cherryPickAbort(repo);
        if (res.code !== 0) throw new Error(res.stderr.trim() || `${op} --skip 失败`);
      });
    },

    async abortOp() {
      const op = get().ongoing;
      if (!op) return;
      const ok = await confirmBox({
        title: `中止这次 ${op}？`,
        body: '会回到操作前的状态，期间已处理的冲突全部丢弃。',
        okText: '中止',
        danger: true,
      });
      if (!ok) return;
      await mutate(`中止 ${op}`, false, async () => {
        const repo = getRepoPath();
        const res =
          op === 'rebase'
            ? await rebaseAbort(repo)
            : op === 'cherry-pick'
              ? await cherryPickAbort(repo)
              : op === 'revert'
                ? await revertAbort(repo)
                : await abortMerge(repo);
        if (res.code !== 0) throw new Error(res.stderr.trim() || `中止 ${op} 失败`);
      });
      set({ conflictSides: null, decisions: {} });
    },

    async lastCommitMessage() {
      const repo = get().repo;
      if (!repo) return '';
      return getLastCommitMessage(repo.path);
    },

    async doCommit(opts) {
      const repo = get().repo;
      if (!repo) return false;
      set({ busy: opts.amend ? '修正提交…' : '提交…', error: null });
      try {
        const res = await createCommit(repo.path, opts);
        if (res.code !== 0) {
          set({ error: (res.stderr || res.stdout).trim() || `git commit 退出码 ${res.code}` });
          return false;
        }
        set({ bottomPanel: 'none' });
        await get().refresh();
        return true;
      } catch (e) {
        set({ error: errMsg(e) });
        return false;
      } finally {
        set({ busy: null });
      }
    },

    setBottomPanel(p) {
      set({ bottomPanel: get().bottomPanel === p ? 'none' : p });
    },

    async createBranchOp(name) {
      await mutate(`创建分支 ${name}`, false, async () => {
        const res = await createBranch(getRepoPath(), name);
        if (res.code !== 0) throw new Error(res.stderr.trim() || '创建分支失败');
      });
    },

    async switchBranchOp(name) {
      await mutate(`切换到 ${name}`, false, async () => {
        const res = await switchBranch(getRepoPath(), name);
        if (res.code !== 0) throw new Error(res.stderr.trim() || '切换分支失败');
      });
    },

    async createTrackingBranchOp(localName, remoteRef) {
      await mutate(`检出 ${localName}`, false, async () => {
        const res = await createTrackingBranch(getRepoPath(), localName, remoteRef);
        if (res.code !== 0) throw new Error(res.stderr.trim() || '创建跟踪分支失败');
      });
    },

    async deleteBranchOp(name) {
      const ok = await confirmBox({
        title: `删除分支「${name}」？`,
        body: '未合并的分支会被 git 拒绝删除。',
        okText: '删除',
        danger: true,
      });
      if (!ok) return;
      await mutate(`删除分支 ${name}`, false, async () => {
        const res = await deleteBranch(getRepoPath(), name);
        if (res.code !== 0) throw new Error(res.stderr.trim() || '删除分支失败');
      });
    },

    async mergeBranchOp(name) {
      await mutate(`合并 ${name}`, true, async () => {
        const res = await mergeBranch(getRepoPath(), name);
        if (res.code !== 0) {
          const msg = res.stderr.trim() || res.stdout.trim();
          // 冲突不算失败，提示去解决
          if (/conflict/i.test(msg)) {
            await get().refresh();
            throw new Error(`${msg}\n\n有冲突，请在「变更」里逐个解决。`);
          }
          throw new Error(msg || '合并失败');
        }
      });
    },

    async rebaseOntoOp(name) {
      const ok = await confirmBox({
        title: `把当前分支变基到「${name}」？`,
        body: '会重写当前分支的提交哈希。冲突时需要逐个解决后执行 git rebase --continue。',
        okText: '变基',
        danger: true,
      });
      if (!ok) return;
      await mutate(`变基到 ${name}`, true, async () => {
        const res = await rebaseOnto(getRepoPath(), name);
        if (res.code !== 0) {
          const msg = res.stderr.trim() || res.stdout.trim();
          if (/conflict/i.test(msg)) {
            await get().refresh();
            throw new Error(`${msg}\n\n有冲突，解决后需要手动执行 git rebase --continue。`);
          }
          throw new Error(msg || '变基失败');
        }
      });
    },

    async stashSaveOp(message) {
      await mutate('保存 stash', false, async () => {
        const res = await saveStash(getRepoPath(), message);
        if (res.code !== 0) throw new Error(res.stderr.trim() || 'stash 失败');
      });
    },

    async stashApplyOp(ref, drop) {
      await mutate(drop ? `pop ${ref}` : `应用 ${ref}`, true, async () => {
        const res = await applyStash(getRepoPath(), ref, drop);
        if (res.code !== 0) throw new Error(res.stderr.trim() || 'stash 应用失败');
      });
    },

    async stashDropOp(ref) {
      const ok = await confirmBox({
        title: `删除 ${ref}？`,
        body: 'stash 删除后只能靠 reflog 找回。',
        okText: '删除',
        danger: true,
      });
      if (!ok) return;
      await mutate(`删除 ${ref}`, false, async () => {
        const res = await dropStash(getRepoPath(), ref);
        if (res.code !== 0) throw new Error(res.stderr.trim() || '删除 stash 失败');
      });
    },

    async createTagOp(name, message) {
      await mutate(`创建标签 ${name}`, false, async () => {
        const res = await createTag(getRepoPath(), name, message);
        if (res.code !== 0) throw new Error(res.stderr.trim() || '创建标签失败');
      });
    },

    async deleteTagOp(name) {
      const ok = await confirmBox({ title: `删除标签「${name}」？`, okText: '删除', danger: true });
      if (!ok) return;
      await mutate(`删除标签 ${name}`, false, async () => {
        const res = await deleteTag(getRepoPath(), name);
        if (res.code !== 0) throw new Error(res.stderr.trim() || '删除标签失败');
      });
    },

    async restoreBackupOp(sha) {
      const ok = await confirmBox({
        title: '恢复这份备份？',
        body: '会把备份里的工作区与暂存区内容重新应用回来。',
        okText: '恢复',
        danger: true,
      });
      if (!ok) return;
      await mutate('恢复备份', false, async () => {
        const res = await restoreBackup(getRepoPath(), sha);
        if (res.code !== 0) throw new Error(res.stderr.trim() || '恢复备份失败');
      });
    },

    askCredentials(label, retry) {
      pendingRetry = retry;
      set({ credRequest: { label }, error: null });
    },

    async submitCredentials(user, pass, remember) {
      const retry = pendingRetry;
      if (!retry) {
        set({ credRequest: null });
        return;
      }
      set({ credRequest: null, error: null });
      setOneShotAuth({ user, pass });
      try {
        await retry();
        if (remember) {
          const repo = get().repo;
          const remote = get().remotes.find((r) => r.name === get().remote);
          const parsed = remote ? parseRemoteUrl(remote.fetchUrl) : null;
          if (repo && parsed) {
            await approveCredentials(repo.path, {
              protocol: parsed.protocol,
              host: parsed.host,
              path: parsed.path,
              username: user,
              password: pass,
            });
          }
        }
      } finally {
        // 一次性凭据用完立即清掉
        setOneShotAuth(null);
        pendingRetry = null;
      }
    },

    cancelCredentials() {
      pendingRetry = null;
      set({ credRequest: null });
    },

    setRemote(name) {
      set({ remote: name });
    },

    async fetchOp() {
      const remote = get().remote;
      const attempt = async (): Promise<void> => {
        set({ busy: `获取 ${remote}…`, error: null });
        try {
          const res = await fetchRemote(getRepoPath(), remote);
          if (res.code !== 0) {
            const raw = res.stderr || res.stdout;
            if (isAuthError(raw)) {
              get().askCredentials(`获取 ${remote}`, attempt);
              return;
            }
            set({ error: humanizeRemoteError(raw) });
            return;
          }
          await reload();
        } catch (e) {
          set({ error: errMsg(e) });
        } finally {
          set({ busy: null });
        }
      };
      await attempt();
    },

    async pullOp(strategy) {
      const repo = get().repo;
      if (!repo) return;
      const attempt = async (): Promise<void> => {
        set({ busy: `拉取（${strategy}）…`, error: null });
        try {
          await createBackup(repo.path, 'pull');
          const res = await pullRemote(repo.path, strategy);
          if (res.code !== 0) {
            const raw = res.stderr || res.stdout;
            if (isAuthError(raw)) {
              get().askCredentials(`拉取（${strategy}）`, attempt);
              return;
            }
            set({ error: humanizeRemoteError(raw) });
            return;
          }
          await reload();
        } catch (e) {
          set({ error: errMsg(e) });
        } finally {
          set({ busy: null });
        }
      };
      await attempt();
    },

    async pushOp(force) {
      const status = get().status;
      const branch = status?.branch.head ?? null;
      if (!branch) {
        set({ error: '当前是 detached HEAD，无法推送。请先切到一个分支。' });
        return;
      }
      if (force) {
        const ok = await confirmBox({
          title: `强制推送 ${branch}？`,
          body: '使用 --force-with-lease：远端在你上次拉取后若被别人更新过会被拒绝。',
          okText: '强制推送',
          danger: true,
        });
        if (!ok) return;
      }
      const remote = get().remote;
      const setUpstream = !status?.branch.upstream;
      const attempt = async (): Promise<void> => {
        set({ busy: `推送 ${branch} → ${remote}…`, error: null });
        try {
          const res = await pushRemote(getRepoPath(), { remote, branch, force, setUpstream });
          if (res.code !== 0) {
            const raw = res.stderr || res.stdout;
            if (isAuthError(raw)) {
              get().askCredentials(`推送 ${branch} → ${remote}`, attempt);
              return;
            }
            set({ error: humanizeRemoteError(raw) });
            return;
          }
          await reload();
        } catch (e) {
          set({ error: errMsg(e) });
        } finally {
          set({ busy: null });
        }
      };
      await attempt();
    },
  };
});

/** 暂存/未暂存条目数（给工具栏和面板显示） */
export function countEntries(s: RepoStatus | null): { total: number; staged: number; worktree: number } {
  if (!s) return { total: 0, staged: 0, worktree: 0 };
  let staged = 0;
  let worktree = 0;
  for (const e of s.entries) {
    if (hasStaged(e)) staged += 1;
    if (hasWorktree(e)) worktree += 1;
  }
  return { total: s.entries.length, staged, worktree };
}

export { hasWorktree, hasStaged };
