import type { Commit, CommitFile } from '../../types';
import { parseLog } from '../../parse/log';
import { parseNameStatus } from '../nameStatus';
import { runGit, runGitChecked } from '../runner';

/** %x1f 分隔字段，%x1e 分隔记录 —— 与 parse/log.ts 一一对应 */
const LOG_FORMAT =
  ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%s', '%D'].join('%x1f') + '%x1e';

export type LogScope = 'local' | 'all';

/**
 * 取提交历史。
 * scope='local' 只看本地分支 + HEAD —— 有几百个远程分支的仓库用 --all 会让泳道数爆炸，
 * 提交图被压成一条糊线。想看全部远程开发线时再切 'all'。
 */
export type LogSearchMode = 'message' | 'path';

export interface LogSearch {
  mode: LogSearchMode;
  text: string;
}

/**
 * 在提交历史里搜索。
 * - message：`--grep` 固定串 + 忽略大小写，查「某件事是哪次提交做的」
 * - path：paths 通配，查「这个文件都在哪些提交里被改过」
 */
export async function searchLog(
  repoPath: string,
  limit: number,
  search: LogSearch,
  scope: LogScope = 'local',
): Promise<Commit[]> {
  const q = search.text.trim();
  if (!q) return getLog(repoPath, limit, scope);

  const args = ['log', '--topo-order', '-n', String(limit), `--format=${LOG_FORMAT}`];
  // 版本范围必须放在 `--` 之前！放后面会被当成路径，搜索范围就退化成只有 HEAD
  args.push('--branches', '--tags', 'HEAD');
  if (scope === 'all') args.push('--remotes');
  if (search.mode === 'message') {
    args.push('-i', '--fixed-strings', `--grep=${q}`);
  } else {
    // 子串匹配，用户输入部分文件名也能命中；代价是不跟重命名（--follow 不支持通配）
    args.push('--', `*${q}*`);
  }

  const res = await runGitChecked(args, { cwd: repoPath, timeoutMs: 60_000 });
  return parseLog(res.stdout);
}

export async function getLog(
  repoPath: string,
  limit = 400,
  scope: LogScope = 'local',
  /** 不参与提交图的完整 refname 列表（refs/heads/x、refs/remotes/o/x），按 `--not` 排除 */
  exclude: string[] = [],
): Promise<Commit[]> {
  // --tags：只在标签上可达的提交也要出现在历史里
  const refs = scope === 'all' ? ['--all'] : ['--branches', '--tags', 'HEAD'];
  const args = ['log', ...refs];
  if (exclude.length > 0) args.push('--not', ...exclude);
  args.push('--topo-order', '-n', String(limit), `--format=${LOG_FORMAT}`);
  const res = await runGitChecked(args, { cwd: repoPath, timeoutMs: 30_000 });
  return parseLog(res.stdout);
}

/* ------------------------------------------------------------------ reflog */

export interface ReflogEntry {
  sha: string;
  /** reflog 的一行描述，例如 "checkout: moving from main to feature-x" */
  message: string;
}

/** HEAD 的移动记录：切分支、reset、commit 都会留痕，找回"丢了"的提交就靠它 */
export async function getReflog(repoPath: string, limit = 40): Promise<ReflogEntry[]> {
  const res = await runGit(['reflog', '-n', String(limit), '--format=%H%x1f%gs'], {
    cwd: repoPath,
    quiet: true,
    timeoutMs: 20_000,
  });
  if (res.code !== 0) return [];
  const out: ReflogEntry[] = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const i = line.indexOf('\x1f');
    if (i <= 0) continue;
    out.push({ sha: line.slice(0, i), message: line.slice(i + 1) });
  }
  return out;
}

/**
 * 某个提交改了哪些文件。
 * merge 提交不能用 git show：它只输出 combined diff（只有相对**所有**父提交都
 * 改过内容的文件才出现，普通合并为空——表现为"没有文件改动"）。
 * 所以一律优先和第一父提交做树对比（git diff <sha>^1 <sha>），这是 GUI 客户端的
 * 标准语义（"这次提交往主线里带进了什么"）；根提交没有 ^1 时退回 git show。
 * --no-renames 把重命名拆成 A+D，避免 -z 下三段式 token 的解析复杂度。
 */
export async function getCommitFiles(repoPath: string, sha: string): Promise<CommitFile[]> {
  let res = await runGit(['diff', '--name-status', '-z', '--no-renames', `${sha}^1`, sha], {
    cwd: repoPath,
    quiet: true,
    timeoutMs: 30_000,
  });
  if (res.code !== 0) {
    // 多半是根提交（没有 ^1），退回 show
    res = await runGit(['show', '--name-status', '--format=', '-z', '--no-renames', sha], {
      cwd: repoPath,
      quiet: true,
      timeoutMs: 20_000,
    });
  }
  if (res.code !== 0) {
    throw new Error(
      res.stderr.trim() || res.stdout.trim() || `读取提交 ${sha.slice(0, 7)} 的文件列表失败`,
    );
  }
  return parseNameStatus(res.stdout);
}

export async function getCommitBody(repoPath: string, sha: string): Promise<string> {
  const res = await runGitChecked(['show', '-s', '--format=%B', sha], {
    cwd: repoPath,
    quiet: true,
    timeoutMs: 20_000,
  });
  return res.stdout.trim();
}
