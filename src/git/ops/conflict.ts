import { invoke } from '@tauri-apps/api/core';
import { runGit } from '../runner';
import { hasConflictMarkers } from '../../conflict/parse';

export interface ConflictSides {
  /** 没有共同祖先（add/add 冲突）时 base 为 null */
  base: string | null;
  ours: string | null;
  theirs: string | null;
  /** 工作区里带冲突标记的内容 */
  merged: string;
  hasMarkers: boolean;
}

interface ReadResult {
  text: string;
  binary: boolean;
  truncated: boolean;
  size: number;
}

/** `git show :<stage>:<path>`，stage 不存在时返回 null（exit 128） */
async function showStage(repoPath: string, stage: 1 | 2 | 3, path: string): Promise<string | null> {
  const res = await runGit(['show', `:${stage}:${path}`], {
    cwd: repoPath,
    quiet: true,
    timeoutMs: 30_000,
  });
  return res.code === 0 ? res.stdout : null;
}

export async function loadConflictSides(repoPath: string, path: string): Promise<ConflictSides> {
  const [base, ours, theirs] = await Promise.all([
    showStage(repoPath, 1, path),
    showStage(repoPath, 2, path),
    showStage(repoPath, 3, path),
  ]);

  let merged = '';
  try {
    const res = await invoke<ReadResult>('read_text_file', {
      req: { path: `${repoPath.replace(/[\\/]+$/, '')}/${path}`, maxBytes: 4 * 1024 * 1024 },
    });
    merged = res.binary ? '' : res.text;
  } catch {
    merged = '';
  }

  return { base, ours, theirs, merged, hasMarkers: hasConflictMarkers(merged) };
}

/** 把解决后的内容写回工作区（尚未 add） */
export async function writeResolvedFile(
  repoPath: string,
  path: string,
  content: string,
): Promise<void> {
  await invoke('write_text_file', {
    req: { path: `${repoPath.replace(/[\\/]+$/, '')}/${path}`, content },
  });
}

/** 标记该文件已解决 */
export async function markResolved(repoPath: string, path: string): Promise<void> {
  const res = await runGit(['add', '--', path], { cwd: repoPath, timeoutMs: 60_000 });
  if (res.code !== 0) throw new Error(res.stderr.trim() || 'git add 失败');
}

/** 整文件采用某一侧（不需要我们写文件，git 直接 checkout stage） */
export async function checkoutSide(
  repoPath: string,
  path: string,
  side: 'ours' | 'theirs',
): Promise<void> {
  const res = await runGit(['checkout', `--${side}`, '--', path], {
    cwd: repoPath,
    timeoutMs: 60_000,
  });
  if (res.code !== 0) throw new Error(res.stderr.trim() || `git checkout --${side} 失败`);
  await markResolved(repoPath, path);
}

export async function abortMerge(repoPath: string) {
  return runGit(['merge', '--abort'], { cwd: repoPath, timeoutMs: 120_000 });
}

export async function rebaseContinue(repoPath: string) {
  return runGit(['rebase', '--continue'], { cwd: repoPath, timeoutMs: 120_000 });
}
