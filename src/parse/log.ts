import type { Commit } from '../types';

const FS = '\x1f';
const RS = '\x1e';

/** 与 git/ops/log.ts 里的 --format 严格对应 */
export function parseLog(out: string): Commit[] {
  const commits: Commit[] = [];
  for (const chunk of out.split(RS)) {
    const rec = chunk.replace(/^[\r\n]+/, '');
    if (!rec.trim()) continue;
    const f = rec.split(FS);
    if (f.length < 10) continue;
    const parentsRaw = f[1].trim();
    const refsRaw = f[9].trim();
    commits.push({
      sha: f[0].trim(),
      parents: parentsRaw ? parentsRaw.split(' ') : [],
      authorName: f[2],
      authorEmail: f[3],
      authorDate: Number(f[4]) || 0,
      committerName: f[5],
      committerEmail: f[6],
      committerDate: Number(f[7]) || 0,
      subject: f[8],
      refs: refsRaw ? refsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
    });
  }
  return commits;
}
