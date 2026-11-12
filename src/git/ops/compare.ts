import type { CommitFile, FilePatch } from '../../types';
import { parsePatches } from '../../parse/diff';
import { parseNameStatus } from '../nameStatus';
import { diffViewArgs } from './diff';
import { runGit, runGitChecked } from '../runner';

export interface CompareResult {
  files: CommitFile[];
  /** A..B 之间的提交数（含 B 不含 A） */
  commitCount: number;
  /** 两个 rev 各自解析后的完整 sha */
  aSha: string;
  bSha: string;
}

/** 校验并展开一个 rev（分支名 / 标签 / sha / HEAD~2 ...） */
export async function resolveRev(repoPath: string, rev: string): Promise<string | null> {
  const res = await runGit(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], {
    cwd: repoPath,
    quiet: true,
    timeoutMs: 15_000,
  });
  return res.code === 0 ? res.stdout.trim() : null;
}

/**
 * 任意两个提交/分支的差异。
 * 与 DAG 关系无关：`git diff A B` 就是两棵树的净差异，
 * 所以「分支 A ↔ 分支 B」和「提交 A ↔ 提交 B（中间隔很多次提交）」是同一套实现。
 */
export async function compareFiles(repoPath: string, a: string, b: string): Promise<CompareResult> {
  const [aSha, bSha] = await Promise.all([resolveRev(repoPath, a), resolveRev(repoPath, b)]);
  if (!aSha) throw new Error(`无法解析左侧版本：${a}`);
  if (!bSha) throw new Error(`无法解析右侧版本：${b}`);

  const [nameStatus, count] = await Promise.all([
    runGitChecked(['diff', '--name-status', '-z', '--no-renames', aSha, bSha], {
      cwd: repoPath,
      quiet: true,
      timeoutMs: 60_000,
    }),
    runGit(['rev-list', '--count', `${aSha}..${bSha}`], {
      cwd: repoPath,
      quiet: true,
      timeoutMs: 60_000,
    }),
  ]);

  const files = parseNameStatus(nameStatus.stdout);

  return {
    files,
    commitCount: Number(count.stdout.trim()) || 0,
    aSha,
    bSha,
  };
}

/** 两个 rev 之间单个文件的 diff */
export async function compareFileDiff(
  repoPath: string,
  aSha: string,
  bSha: string,
  path: string,
): Promise<FilePatch[]> {
  const res = await runGit(
    ['diff', '--no-color', '--no-ext-diff', '-U3', ...diffViewArgs(), aSha, bSha, '--', path],
    {
      cwd: repoPath,
      timeoutMs: 60_000,
    },
  );
  return parsePatches(res.stdout);
}

/** 两个 rev 的增删行统计，用于标题栏展示 */
export async function compareStat(
  repoPath: string,
  aSha: string,
  bSha: string,
): Promise<{ files: number; insertions: number; deletions: number }> {
  const res = await runGit(['diff', '--shortstat', aSha, bSha], {
    cwd: repoPath,
    quiet: true,
    timeoutMs: 60_000,
  });
  const text = res.stdout.trim();
  const ins = /(\d+) insertion/.exec(text);
  const del = /(\d+) deletion/.exec(text);
  const files = /(\d+) file/.exec(text);
  return {
    files: files ? Number(files[1]) : 0,
    insertions: ins ? Number(ins[1]) : 0,
    deletions: del ? Number(del[1]) : 0,
  };
}
