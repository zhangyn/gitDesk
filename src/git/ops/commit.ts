import { runGit } from '../runner';

export interface CommitOptions {
  message: string;
  amend: boolean;
  signoff: boolean;
  /** 跳过 pre-commit / commit-msg 钩子（--no-verify） */
  noVerify?: boolean;
  /** 允许空提交（例如只跑 hooks） */
  allowEmpty?: boolean;
}

/**
 * 提交。消息通过 stdin 传入（-F -），避免 Windows 下的引号/编码/换行转义问题。
 * 非零退出码不抛异常，由 UI 展示 stderr（含 hooks 输出）。
 */
export async function createCommit(repoPath: string, opts: CommitOptions) {
  const args = ['commit', '--file', '-', '--cleanup=strip'];
  if (opts.amend) args.push('--amend');
  if (opts.signoff) args.push('--signoff');
  if (opts.noVerify) args.push('--no-verify');
  if (opts.allowEmpty) args.push('--allow-empty');

  const res = await runGit(args, {
    cwd: repoPath,
    input: opts.message,
    timeoutMs: 300_000, // pre-commit / commit-msg 钩子可能很久
  });
  return res;
}

/** 读回上一次提交信息（修正模式预填用） */
export async function getLastCommitMessage(repoPath: string): Promise<string> {
  const res = await runGit(['log', '-1', '--format=%B'], { cwd: repoPath, quiet: true });
  return res.code === 0 ? res.stdout.replace(/\s+$/, '') : '';
}

/**
 * 最近若干条提交信息（提交面板「最近消息」下拉用）。
 * %x1e 作记录分隔符——提交正文里可以有任意内容，靠它切开才不会串。
 */
export async function getRecentCommitMessages(repoPath: string, limit = 15): Promise<string[]> {
  const res = await runGit(['log', '-n', String(limit), '--format=%B%x1e'], {
    cwd: repoPath,
    quiet: true,
    timeoutMs: 20_000,
  });
  if (res.code !== 0) return [];
  return res.stdout
    .split('\x1e')
    .map((m) => m.replace(/\s+$/, '').trim())
    .filter((m) => m.length > 0);
}

/**
 * 撤销最后一次提交：reset --soft HEAD~1，HEAD 后移一位，改动完整回到暂存区。
 * 对根提交会失败（没有父提交），由调用方把 stderr 展示给用户。
 */
export async function undoLastCommit(repoPath: string) {
  return runGit(['reset', '--soft', 'HEAD~1'], { cwd: repoPath, timeoutMs: 60_000 });
}
