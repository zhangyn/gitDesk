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
export async function getLog(
  repoPath: string,
  limit = 400,
  scope: LogScope = 'local',
): Promise<Commit[]> {
  const refs = scope === 'all' ? ['--all'] : ['--branches', 'HEAD'];
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
