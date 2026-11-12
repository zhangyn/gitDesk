import { runGit, runGitChecked } from '../runner';

/** 暂存整个文件（含删除、重命名） */
export async function stageFile(repoPath: string, path: string): Promise<void> {
  await runGitChecked(['add', '-A', '--', path], { cwd: repoPath, timeoutMs: 60_000 });
}

/** 暂存指定的多个文件（-A 让删除也能被记录） */
export async function stagePaths(repoPath: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await runGitChecked(['add', '-A', '--', ...paths], { cwd: repoPath, timeoutMs: 120_000 });
}

/** 取消暂存指定的多个文件；没有 HEAD 时退化为 rm --cached */
export async function unstagePaths(repoPath: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const res = await runGit(['restore', '--staged', '--', ...paths], { cwd: repoPath });
  if (res.code === 0) return;
  await runGitChecked(['rm', '--cached', '-r', '-q', '--', ...paths], { cwd: repoPath });
}

export async function stageAll(repoPath: string): Promise<void> {
  await runGitChecked(['add', '-A'], { cwd: repoPath, timeoutMs: 120_000 });
}

/** 取消暂存整个文件。没有 HEAD（初始提交前）时退化为 rm --cached */
export async function unstageFile(repoPath: string, path: string): Promise<void> {
  const res = await runGit(['restore', '--staged', '--', path], { cwd: repoPath });
  if (res.code === 0) return;
  await runGitChecked(['rm', '--cached', '-r', '-q', '--', path], { cwd: repoPath });
}

export async function unstageAll(repoPath: string): Promise<void> {
  const res = await runGit(['reset', '-q', 'HEAD', '--'], { cwd: repoPath });
  if (res.code === 0) return;
  await runGitChecked(['rm', '--cached', '-r', '-q', '--', '.'], { cwd: repoPath });
}

function assertPatch(patch: string): void {
  if (!patch.trim()) throw new Error('没有选中任何改动');
}

/**
 * 把 patch 应用到 index。
 * reverse=true 用于「取消暂存」。
 */
export async function applyPatchToIndex(
  repoPath: string,
  patch: string,
  reverse: boolean,
): Promise<void> {
  assertPatch(patch);
  const args = ['apply', '--cached', '--recount', '--whitespace=nowarn'];
  if (reverse) args.push('-R');
  args.push('-');
  const res = await runGit(args, { cwd: repoPath, input: patch, timeoutMs: 60_000 });
  if (res.code !== 0) {
    throw new Error(`git apply 失败：\n${(res.stderr || res.stdout).trim()}`);
  }
}

/** 把 patch 反向应用到工作区（丢弃部分改动） */
export async function applyPatchToWorktree(
  repoPath: string,
  patch: string,
  reverse: boolean,
): Promise<void> {
  assertPatch(patch);
  const args = ['apply', '--recount', '--whitespace=nowarn'];
  if (reverse) args.push('-R');
  args.push('-');
  const res = await runGit(args, { cwd: repoPath, input: patch, timeoutMs: 60_000 });
  if (res.code !== 0) {
    throw new Error(`git apply 失败：\n${(res.stderr || res.stdout).trim()}`);
  }
}

/** 丢弃整个文件的工作区改动。未跟踪文件走 git clean（不可恢复）。 */
export async function discardFileChanges(
  repoPath: string,
  path: string,
  untracked: boolean,
): Promise<void> {
  if (untracked) {
    const res = await runGit(['clean', '-f', '-d', '--', path], { cwd: repoPath });
    if (res.code !== 0) throw new Error(res.stderr.trim() || 'git clean 失败');
    return;
  }
  const res = await runGit(['restore', '--worktree', '--', path], { cwd: repoPath });
  if (res.code !== 0) {
    // 没有 HEAD 的初始状态无法 restore
    throw new Error(res.stderr.trim() || 'git restore 失败');
  }
}

/* ---------------------------------------------------------- 清理未跟踪 */

/**
 * dry-run：列出将被清理的未跟踪文件/目录（不删任何东西）。
 * 输出格式为 "Would remove <path>/"，嵌套 git 仓库是 "Would skip repository ..."。
 */
export async function cleanPreview(repoPath: string): Promise<string[]> {
  const res = await runGit(['clean', '-n', '-d'], {
    cwd: repoPath,
    quiet: true,
    timeoutMs: 30_000,
  });
  if (res.code !== 0) throw new Error(res.stderr.trim() || 'git clean 预览失败');
  const out: string[] = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    const m = /^Would (?:remove|skip repository) (.+?)\/?$/.exec(line.trim());
    if (m) out.push(m[1]);
  }
  return out;
}

/** 执行清理：删除未跟踪的文件和目录。不动被 .gitignore 忽略的内容（安全默认）。 */
export async function cleanUntracked(repoPath: string): Promise<void> {
  const res = await runGit(['clean', '-f', '-d'], { cwd: repoPath, timeoutMs: 60_000 });
  if (res.code !== 0) throw new Error(res.stderr.trim() || 'git clean 失败');
}
