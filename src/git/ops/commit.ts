import { runGit } from '../runner';

export interface CommitOptions {
  message: string;
  amend: boolean;
  signoff: boolean;
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
