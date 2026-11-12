import type { CommitFile } from '../types';

/**
 * `git diff --name-status -z` 的 token 解析：status 和 path 成对出现（NUL 分隔）。
 * log.ts / compare.ts / stash.ts 的重复解析循环收敛到这里。
 */
export function parseNameStatus(stdout: string): CommitFile[] {
  const tokens = stdout.split('\0').filter((t) => t.length > 0);
  const files: CommitFile[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const status = tokens[i];
    const path = tokens[i + 1];
    if (!status || !path) break;
    files.push({ path, status: status[0] });
  }
  return files;
}
