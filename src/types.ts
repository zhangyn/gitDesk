/** 与 Rust 侧 RunResult 对齐 */
export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  command: string;
  timedOut: boolean;
}

export interface ProbeResult {
  found: boolean;
  path: string;
  version: string;
  source: string;
}

export interface RepoInfo {
  /** 工作区根目录（绝对路径） */
  path: string;
  gitDir: string;
  name: string;
}

export interface BranchInfo {
  /** 当前分支名；detached 时为 null */
  head: string | null;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface StatusEntry {
  path: string;
  origPath?: string;
  kind: 'tracked' | 'renamed' | 'unmerged' | 'untracked';
  /** porcelain v2 的 X：暂存区状态 */
  index: string;
  /** porcelain v2 的 Y：工作区状态 */
  worktree: string;
  stages?: { m1: string; m2: string; m3: string };
}

export interface RepoStatus {
  branch: BranchInfo;
  entries: StatusEntry[];
}

export interface Commit {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: number;
  committerName: string;
  committerEmail: string;
  committerDate: number;
  subject: string;
  /** %D 装饰，例如 "HEAD -> main"、"origin/main"、"tag: v1" */
  refs: string[];
}

export interface DiffLine {
  kind: 'ctx' | 'add' | 'del' | 'meta';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FilePatch {
  oldPath: string;
  newPath: string;
  header: string[];
  hunks: DiffHunk[];
  isBinary: boolean;
  isNew: boolean;
  isDeleted: boolean;
  /** 由前端合成的 patch（未跟踪文件） */
  synthetic?: boolean;
}

export interface CommitFile {
  path: string;
  /** A/M/D/T/U，取 git --name-status 首字母 */
  status: string;
}

export type RefKind = 'branch' | 'remote' | 'tag';

export interface RefEntry {
  name: string;
  /** 完整 refname，例如 refs/remotes/origin/feature-x */
  fullName: string;
  sha: string;
  upstream: string;
  kind: RefKind;
  /** 相对上游领先的提交数（本地多于远程） */
  ahead: number;
  /** 相对上游落后的提交数（本地少于远程） */
  behind: number;
  /** 上游已被删除 */
  gone: boolean;
}

/** 变更的两个侧面：工作区 / 暂存区 */
export type Side = 'worktree' | 'staged';

/** 最近打开的仓库 */
export interface RepoEntry {
  path: string;
  name: string;
  openedAt: number;
}
