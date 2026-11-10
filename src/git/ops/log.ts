import type { Commit, CommitFile } from '../../types';
import { parseLog } from '../../parse/log';
import { runGitChecked } from '../runner';

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
): Promise<Commit[]> {
  // --tags：只在标签上可达的提交也要出现在历史里
  const refs = scope === 'all' ? ['--all'] : ['--branches', '--tags', 'HEAD'];
  const res = await runGitChecked(
    ['log', ...refs, '--topo-order', '-n', String(limit), `--format=${LOG_FORMAT}`],
    { cwd: repoPath, timeoutMs: 30_000 },
  );
  return parseLog(res.stdout);
}

/**
 * 某个提交改了哪些文件。
 * 用 --no-renames 把重命名拆成 A+D，避免 -z 下三段式 token 的解析复杂度。
 */
export async function getCommitFiles(repoPath: string, sha: string): Promise<CommitFile[]> {
  const res = await runGitChecked(
    ['show', '--name-status', '--format=', '-z', '--no-renames', sha],
    { cwd: repoPath, quiet: true, timeoutMs: 20_000 },
  );
  const tokens = res.stdout.split('\0').filter((t) => t.length > 0);
  const files: CommitFile[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const status = tokens[i];
    const path = tokens[i + 1];
    if (!status || !path) break;
    files.push({ path, status: status[0] });
  }
  return files;
}

export async function getCommitBody(repoPath: string, sha: string): Promise<string> {
  const res = await runGitChecked(['show', '-s', '--format=%B', sha], {
    cwd: repoPath,
    quiet: true,
    timeoutMs: 20_000,
  });
  return res.stdout.trim();
}
