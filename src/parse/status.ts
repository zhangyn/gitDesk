import type { BranchInfo, RepoStatus, StatusEntry } from '../types';

const NUL = '\0';

/**
 * 解析 `git status --porcelain=v2 -z --branch`。
 *
 * 格式（每条记录以 NUL 结尾，重命名记录后面紧跟一个额外的原名 token）：
 *   # branch.oid <sha>
 *   # branch.head <name>|(detached)
 *   # branch.upstream <name>
 *   # branch.ab +<ahead> -<behind>
 *   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
 *   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path> \0 <origPath>
 *   u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
 *   ? <path>
 *   ! <path>
 */
export function parseStatusV2(out: string): RepoStatus {
  const branch: BranchInfo = {
    head: null,
    oid: null,
    upstream: null,
    ahead: 0,
    behind: 0,
  };
  const entries: StatusEntry[] = [];
  const tokens = out.split(NUL);

  for (let i = 0; i < tokens.length; i++) {
    const rec = tokens[i];
    if (!rec) continue;

    if (rec.startsWith('# ')) {
      const rest = rec.slice(2);
      if (rest.startsWith('branch.oid ')) {
        const v = rest.slice('branch.oid '.length).trim();
        branch.oid = v === '(initial)' ? null : v;
      } else if (rest.startsWith('branch.head ')) {
        const v = rest.slice('branch.head '.length).trim();
        branch.head = v === '(detached)' ? null : v;
      } else if (rest.startsWith('branch.upstream ')) {
        branch.upstream = rest.slice('branch.upstream '.length).trim();
      } else if (rest.startsWith('branch.ab ')) {
        const m = rest.slice('branch.ab '.length).match(/\+(\d+)\s+-(\d+)/);
        if (m) {
          branch.ahead = Number(m[1]);
          branch.behind = Number(m[2]);
        }
      }
      continue;
    }

    const tag = rec[0];
    if (tag === '1') {
      const p = rec.split(' ');
      const xy = p[1] ?? '..';
      entries.push({
        path: p.slice(8).join(' '),
        kind: 'tracked',
        index: xy[0] ?? '.',
        worktree: xy[1] ?? '.',
      });
    } else if (tag === '2') {
      const p = rec.split(' ');
      const xy = p[1] ?? '..';
      // 重命名的原名在下一个 token
      const origPath = tokens[i + 1];
      if (origPath !== undefined) i += 1;
      entries.push({
        path: p.slice(9).join(' '),
        origPath,
        kind: 'renamed',
        index: xy[0] ?? '.',
        worktree: xy[1] ?? '.',
      });
    } else if (tag === 'u') {
      const p = rec.split(' ');
      const xy = p[1] ?? 'UU';
      entries.push({
        path: p.slice(10).join(' '),
        kind: 'unmerged',
        index: xy[0] ?? 'U',
        worktree: xy[1] ?? 'U',
        stages: { m1: p[3] ?? '', m2: p[4] ?? '', m3: p[5] ?? '' },
      });
    } else if (tag === '?') {
      entries.push({
        path: rec.slice(2),
        kind: 'untracked',
        index: '?',
        worktree: '?',
      });
    }
    // '!' 忽略文件不展示
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { branch, entries };
}

/** 暂存区里有改动的条目（X 不是 '.' 也不是 '?'） */
export function stagedEntries(s: RepoStatus | null): StatusEntry[] {
  if (!s) return [];
  return s.entries.filter((e) => e.kind !== 'untracked' && e.index !== '.');
}

/** 工作区有改动的条目（Y 不是 '.') */
export function unstagedEntries(s: RepoStatus | null): StatusEntry[] {
  if (!s) return [];
  return s.entries.filter((e) => e.kind !== 'untracked' && e.worktree !== '.');
}

export function untrackedEntries(s: RepoStatus | null): StatusEntry[] {
  if (!s) return [];
  return s.entries.filter((e) => e.kind === 'untracked');
}

export function conflictEntries(s: RepoStatus | null): StatusEntry[] {
  if (!s) return [];
  return s.entries.filter((e) => e.kind === 'unmerged');
}
