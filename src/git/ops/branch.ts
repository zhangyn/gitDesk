import { runGit } from '../runner';

export type ResetMode = 'soft' | 'mixed' | 'hard';

/** 把当前分支重置到指定提交。soft=改动留暂存区，mixed=改动回工作区，hard=全部丢弃 */
export async function resetTo(repoPath: string, sha: string, mode: ResetMode) {
  return runGit(['reset', `--${mode}`, sha], { cwd: repoPath, timeoutMs: 120_000 });
}

/** 新建并切换到新分支 */
export async function createBranch(repoPath: string, name: string, startAt?: string) {
  const args = ['switch', '-c', name];
  if (startAt) args.push(startAt);
  return runGit(args, { cwd: repoPath, timeoutMs: 60_000 });
}

/** 在指定提交上创建分支（不切换工作区，SmartGit 的 Add Branch 语义） */
export async function createBranchAt(repoPath: string, name: string, sha: string) {
  return runGit(['branch', name, sha], { cwd: repoPath, timeoutMs: 60_000 });
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

/**
 * 合并某个分支到当前分支。
 * squash=true 时用 --squash：改动进暂存区、不产生合并提交（提交信息由用户自己写）。
 */
export async function mergeBranch(repoPath: string, name: string, squash = false) {
  const args = squash ? ['merge', '--squash'] : ['merge', '--no-ff', '--no-edit'];
  args.push(name);
  return runGit(args, {
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
export async function createTrackingBranch(repoPath: string, localName: string, remoteRef: string) {
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

/* --------------------------------------------------- 多步操作的后续动作 */

export async function rebaseContinue(repoPath: string) {
  return runGit(['rebase', '--continue'], { cwd: repoPath, timeoutMs: 300_000 });
}

export async function rebaseSkip(repoPath: string) {
  return runGit(['rebase', '--skip'], { cwd: repoPath, timeoutMs: 300_000 });
}

export async function rebaseAbort(repoPath: string) {
  return runGit(['rebase', '--abort'], { cwd: repoPath, timeoutMs: 300_000 });
}

export async function cherryPickContinue(repoPath: string) {
  return runGit(['cherry-pick', '--continue'], { cwd: repoPath, timeoutMs: 300_000 });
}

export async function cherryPickAbort(repoPath: string) {
  return runGit(['cherry-pick', '--abort'], { cwd: repoPath, timeoutMs: 300_000 });
}

export async function revertContinue(repoPath: string) {
  return runGit(['revert', '--continue'], { cwd: repoPath, timeoutMs: 300_000 });
}

export async function revertAbort(repoPath: string) {
  return runGit(['revert', '--abort'], { cwd: repoPath, timeoutMs: 300_000 });
}

/* ------------------------------------------------- 挑拣 / 还原单个提交 */

/** 把某个提交拣选到当前分支（可能冲突，冲突后走 ongoing 横幅继续/中止） */
export async function cherryPick(repoPath: string, sha: string) {
  return runGit(['cherry-pick', sha], { cwd: repoPath, timeoutMs: 300_000 });
}

/** 生成一个反向提交（不改历史），--no-edit 避免弹编辑器 */
export async function revertCommit(repoPath: string, sha: string) {
  return runGit(['revert', '--no-edit', sha], { cwd: repoPath, timeoutMs: 300_000 });
}
