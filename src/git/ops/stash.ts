import type { CommitFile, FilePatch } from '../../types';
import { parsePatches } from '../../parse/diff';
import { diffViewArgs } from './diff';
import { runGit } from '../runner';

export interface StashEntry {
  /** stash@{0} 这种形式，可直接传给 git */
  ref: string;
  date: number;
  subject: string;
}

const STASH_FORMAT = '%gd%x1f%ct%x1f%s';

export async function listStashes(repoPath: string): Promise<StashEntry[]> {
  const res = await runGit(['stash', 'list', `--format=${STASH_FORMAT}`], {
    cwd: repoPath,
    quiet: true,
  });
  if (res.code !== 0) return [];
  const out: StashEntry[] = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [ref, ct, subject] = line.split('\x1f');
    if (!ref) continue;
    out.push({ ref, date: Number(ct) || 0, subject: subject ?? '' });
  }
  return out;
}

/** 保存 stash（含未跟踪文件，否则用户会疑惑"为什么没存进去"） */
export async function saveStash(repoPath: string, message: string) {
  const args = ['stash', 'push', '--include-untracked'];
  if (message.trim()) args.push('-m', message.trim());
  return runGit(args, { cwd: repoPath, timeoutMs: 120_000 });
}

export async function applyStash(repoPath: string, ref: string, drop: boolean) {
  return runGit(['stash', drop ? 'pop' : 'apply', ref], { cwd: repoPath, timeoutMs: 120_000 });
}

export async function dropStash(repoPath: string, ref: string) {
  return runGit(['stash', 'drop', ref], { cwd: repoPath });
}

/** stash 里改了哪些文件（对比 stash 的父提交 = 当时的工作基线） */
export async function stashFiles(repoPath: string, ref: string): Promise<CommitFile[]> {
  const res = await runGit(['diff', '--name-status', '-z', '--no-renames', `${ref}^1`, ref], {
    cwd: repoPath,
    quiet: true,
    timeoutMs: 30_000,
  });
  if (res.code !== 0) return [];
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

/** stash 里单个文件的 diff */
export async function stashFileDiff(
  repoPath: string,
  ref: string,
  path: string,
): Promise<FilePatch[]> {
  const res = await runGit(
    ['diff', '--no-color', '--no-ext-diff', '-U3', ...diffViewArgs(), `${ref}^1`, ref, '--', path],
    { cwd: repoPath, timeoutMs: 60_000 },
  );
  return parsePatches(res.stdout);
}

/* ------------------------------------------------------------------ 备份 */

export interface BackupEntry {
  ref: string;
  sha: string;
}

/**
 * 写索引 / 工作区之前的兜底快照。
 *
 * `git stash create` 不修改工作区，只产生一个 commit 对象；
 * 但它不建引用，对象会被 gc —— 所以立刻 update-ref 到 refs/gitdesk/backups/*。
 * 恢复用 `git stash apply <sha>`，等价于把当时的工作区+索引还回来。
 */
export async function createBackup(repoPath: string, label: string): Promise<string | null> {
  const res = await runGit(['stash', 'create'], { cwd: repoPath, quiet: true, timeoutMs: 60_000 });
  const sha = res.stdout.trim();
  if (res.code !== 0 || !sha) return null;

  const safeLabel = label.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'op';
  const ref = `refs/gitdesk/backups/${Date.now()}-${safeLabel}`;
  const upd = await runGit(['update-ref', ref, sha], { cwd: repoPath, quiet: true });
  return upd.code === 0 ? ref : null;
}

export async function listBackups(repoPath: string): Promise<BackupEntry[]> {
  const res = await runGit(
    ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/gitdesk/backups'],
    { cwd: repoPath, quiet: true },
  );
  if (res.code !== 0) return [];
  const out: BackupEntry[] = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const [ref, sha] = t.split(' ');
    if (ref && sha) out.push({ ref, sha });
  }
  // 最新的在前
  out.sort((a, b) => (a.ref < b.ref ? 1 : -1));
  return out;
}

export async function restoreBackup(repoPath: string, sha: string) {
  return runGit(['stash', 'apply', sha], { cwd: repoPath, timeoutMs: 120_000 });
}

export async function dropBackup(repoPath: string, ref: string) {
  return runGit(['update-ref', '-d', ref], { cwd: repoPath, quiet: true });
}
