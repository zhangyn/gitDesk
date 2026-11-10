import type { RepoStatus } from '../../types';
import { parseStatusV2 } from '../../parse/status';
import { runGitChecked } from '../runner';

export async function getStatus(repoPath: string): Promise<RepoStatus> {
  const res = await runGitChecked(
    // --no-optional-locks：不让 status 顺手刷新/写 .git/index，
    // 否则文件监听会被自己触发的 index 写入反复唤醒，形成刷新循环。
    // 注意它是 **git 全局选项**，必须放在子命令前面（放后面 status 会直接报错）。
    [
      '--no-optional-locks',
      'status',
      '--porcelain=v2',
      '-z',
      '--branch',
      '--untracked-files=normal',
    ],
    { cwd: repoPath, timeoutMs: 60_000 },
  );
  return parseStatusV2(res.stdout);
}
