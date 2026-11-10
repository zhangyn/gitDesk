import { runGit } from '../runner';

export interface RemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

/** `git remote -v` 解析；同一 remote 的 fetch/push 两行合并成一条 */
export async function listRemotes(repoPath: string): Promise<RemoteInfo[]> {
  const res = await runGit(['remote', '-v'], { cwd: repoPath, quiet: true });
  if (res.code !== 0) return [];

  const map = new Map<string, RemoteInfo>();
  for (const line of res.stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    // 格式：<name>\t<url> (fetch|push)
    const m = /^(\S+)\s+(.+?)\s+\((fetch|push)\)$/.exec(t);
    if (!m) continue;
    const [, name, url, kind] = m;
    const cur = map.get(name) ?? { name, fetchUrl: '', pushUrl: '' };
    if (kind === 'fetch') cur.fetchUrl = url;
    else cur.pushUrl = url;
    map.set(name, cur);
  }
  return [...map.values()];
}

/**
 * 拉取。GIT_TERMINAL_PROMPT=0 由 Rust 侧注入，所以缺凭据时会立刻失败而不是挂住。
 * 错误信息里带上人工排查提示。
 */
export async function fetchRemote(repoPath: string, remote: string, prune = true) {
  const args = ['fetch', remote];
  if (prune) args.push('--prune');
  args.push('--tags');
  return runGit(args, { cwd: repoPath, timeoutMs: 600_000 });
}

export async function pullRemote(
  repoPath: string,
  strategy: 'ff-only' | 'rebase' | 'merge',
) {
  const args = ['pull'];
  if (strategy === 'ff-only') args.push('--ff-only');
  if (strategy === 'rebase') args.push('--rebase');
  return runGit(args, { cwd: repoPath, timeoutMs: 600_000 });
}

export interface PushOptions {
  remote: string;
  branch: string;
  force?: boolean;
  setUpstream?: boolean;
}

/**
 * 推送。force 一律用 --force-with-lease：只要远端在你上次 fetch 之后被别人改过就会拒绝，
 * 比 --force 安全一个数量级。
 */
export async function pushRemote(repoPath: string, opts: PushOptions) {
  const args = ['push'];
  if (opts.force) args.push('--force-with-lease');
  if (opts.setUpstream) args.push('--set-upstream');
  args.push(opts.remote, `refs/heads/${opts.branch}`);
  return runGit(args, { cwd: repoPath, timeoutMs: 600_000 });
}

/** git 远程错误太长，抽出一句人话 */
export function humanizeRemoteError(stderr: string): string {
  const s = stderr.trim();
  if (/could not read Username|Authentication failed|terminal prompts disabled/i.test(s)) {
    return `${s}\n\n提示：GitDesk 不会弹凭据框（避免卡死）。请先在终端执行一次 git fetch 让 Git 凭据管理器记住账号，或用 SSH 方式配置 remote。`;
  }
  if (/non-fast-forward|rejected/i.test(s)) {
    return `${s}\n\n提示：远端有你本地没有的提交。先「拉取」，或勾选「强制推送（带 lease）」。`;
  }
  if (/no upstream branch|has no upstream branch/i.test(s)) {
    return `${s}\n\n提示：这个分支还没有上游。推送时勾选「设为上游」。`;
  }
  return s;
}
