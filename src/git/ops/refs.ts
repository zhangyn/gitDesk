import type { RefEntry } from '../../types';
import { runGitChecked } from '../runner';

/**
 * refname 里不可能有空格，所以用空格分隔字段是安全的。
 * 输出：<objectname> <refname> <upstream>
 */
export async function getRefs(repoPath: string): Promise<RefEntry[]> {
  // %(upstream:track) 形如 "[ahead 1, behind 2]" / "[gone]"，内部含空格，
  // 所以放在最后一位，用 slice(3).join(' ') 取回来
  const res = await runGitChecked(
    [
      'for-each-ref',
      '--format=%(objectname) %(refname) %(upstream:short) %(upstream:track)',
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ],
    { cwd: repoPath, quiet: true, timeoutMs: 20_000 },
  );

  const out: RefEntry[] = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(' ');
    const sha = parts[0] ?? '';
    const refname = parts[1] ?? '';
    const upstream = parts[2] ?? '';
    const track = parts.slice(3).join(' ');
    const aheadMatch = /ahead\s+(\d+)/.exec(track);
    const behindMatch = /behind\s+(\d+)/.exec(track);
    const ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
    const behind = behindMatch ? Number(behindMatch[1]) : 0;
    const gone = /\bgone\b/.test(track);
    let kind: RefEntry['kind'] = 'branch';
    let name = refname;
    if (refname.startsWith('refs/heads/')) {
      name = refname.slice('refs/heads/'.length);
      kind = 'branch';
    } else if (refname.startsWith('refs/remotes/')) {
      name = refname.slice('refs/remotes/'.length);
      kind = 'remote';
    } else if (refname.startsWith('refs/tags/')) {
      name = refname.slice('refs/tags/'.length);
      kind = 'tag';
    } else {
      continue;
    }
    // origin/HEAD 这类符号引用不展示
    if (name.endsWith('/HEAD')) continue;
    out.push({ name, fullName: refname, sha, upstream, kind, ahead, behind, gone });
  }
  return out;
}
