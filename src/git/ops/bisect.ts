// git bisect 的 UI 化：二分定位引入问题的提交。
//!
//! 交互流程（与 SmartGit 一致）：
//! 1. 在提交图上选中一个已知「坏」的提交，点「二分」→ git bisect start <sha>
//! 2. 选中一个已知「好」的提交，点「好标记」→ git bisect good <sha>，范围确定
//! 3. git 自动检出中间提交 → 用户测试 → 横幅上点「当前是好的/坏的」
//! 4. 范围缩到单个提交时 git 报出第一个坏提交 → 点「结束」回到原分支

import { runGit } from '../runner';

export type BisectTerm = 'good' | 'bad' | 'skip';

/** 是否正在进行 bisect（git bisect log 只在 bisect 状态下成功） */
export async function isBisecting(repoPath: string): Promise<boolean> {
  const res = await runGit(['bisect', 'log'], {
    cwd: repoPath,
    quiet: true,
    timeoutMs: 15_000,
  });
  // 老版本 git 在非 bisect 状态下可能以非零退出，保险起见再排除一次文案
  if (res.code !== 0) return false;
  return !/not bisecting/i.test(res.stdout + res.stderr);
}

/** 开始二分。badSha 是已知「坏」的提交（用户在提交图上选的那个） */
export async function bisectStart(repoPath: string, badSha?: string) {
  const args = ['bisect', 'start'];
  if (badSha) args.push(badSha);
  return runGit(args, { cwd: repoPath, timeoutMs: 60_000 });
}

/**
 * 标记好/坏/跳过。
 * 不带 rev：标记当前检出的提交（测试完中间点后的标准动作）；
 * 带 rev：标记历史里的某个提交（确定范围用）。
 */
export async function bisectMark(repoPath: string, term: BisectTerm, rev?: string) {
  const args = ['bisect', term];
  if (rev) args.push(rev);
  return runGit(args, { cwd: repoPath, timeoutMs: 60_000 });
}

/** 结束二分并回到原分支 */
export async function bisectReset(repoPath: string) {
  return runGit(['bisect', 'reset'], { cwd: repoPath, timeoutMs: 60_000 });
}
