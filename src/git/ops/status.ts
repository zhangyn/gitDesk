import type { RepoStatus } from '../../types';
import { parseStatusV2 } from '../../parse/status';
import { runGitChecked } from '../runner';

export async function getStatus(repoPath: string): Promise<RepoStatus> {
  const res = await runGitChecked(
    ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=normal'],
    { cwd: repoPath, timeoutMs: 60_000 },
  );
  return parseStatusV2(res.stdout);
}
