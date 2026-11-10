import { runGit } from '../runner';

/** 新建并切换到新分支 */
export async function createBranch(repoPath: string, name: string, startAt?: string) {
  const args = ['switch', '-c', name];
  if (startAt) args.push(startAt);
  return runGit(args, { cwd: repoPath, timeoutMs: 60_000 });
}

/** 切换分支。工作区脏时 git 可能拒绝，错误原样返回给 UI。 */
export async function switchBranch(repoPath: string, name: string) {
  return runGit(['switch', name], { cwd: repoPath, timeoutMs: 120_000 });
}

export async function switchToCommit(repoPath: string, sha: string) {
  return runGit(['switch', '--detach', sha], { cwd: repoPath, timeoutMs: 60_000 });
}

/** 删除分支。-d 会拒绝未合并的分支，force 时用 -D */
export async function deleteBranch(repoPath: string, name: string, force = false) {
  return runGit(['branch', force ? '-D' : '-d', '--', name], { cwd: repoPath });
}

/** 合并某个分支到当前分支（--no-ff 保留合并点，便于看出来龙去脉） */
export async function mergeBranch(repoPath: string, name: string) {
  return runGit(['merge', '--no-ff', '--no-edit', name], {
    cwd: repoPath,
    timeoutMs: 300_000,
  });
}

/** 把当前分支变基到目标分支上 */
export async function rebaseOnto(repoPath: string, name: string) {
  return runGit(['rebase', name], { cwd: repoPath, timeoutMs: 600_000 });
}

/**
 * 把远程分支拿到本地：不存在就 --track 建一个并切过去；已存在就直接切过去并重设上游。
 * remoteRef 传完整形式（origin/feature-x）。
 */
export async function createTrackingBranch(
  repoPath: string,
  localName: string,
  remoteRef: string,
) {
  const exists = await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${localName}`], {
    cwd: repoPath,
    quiet: true,
  });
  if (exists.code === 0) {
    const sw = await runGit(['switch', localName], { cwd: repoPath, timeoutMs: 120_000 });
    if (sw.code !== 0) return sw;
    return runGit(['branch', `--set-upstream-to=${remoteRef}`, localName], { cwd: repoPath });
  }
  return runGit(['switch', '-c', localName, '--track', remoteRef], {
    cwd: repoPath,
    timeoutMs: 120_000,
  });
}

export async function renameBranch(repoPath: string, from: string, to: string) {
  return runGit(['branch', '-m', from, to], { cwd: repoPath });
}

/** 检测进行中的多步操作（merge / rebase / cherry-pick / revert），用于 UI 提示 */
export async function getOngoingOperation(repoPath: string): Promise<string | null> {
  const probes: Array<[string, string]> = [
    ['MERGE_HEAD', 'merge'],
    ['REBASE_HEAD', 'rebase'],
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
  ];
  for (const [head, label] of probes) {
    const res = await runGit(['rev-parse', '--verify', '--quiet', head], {
      cwd: repoPath,
      quiet: true,
    });
    if (res.code === 0 && res.stdout.trim()) return label;
  }
  return null;
}
