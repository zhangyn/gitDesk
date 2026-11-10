import type { DiffHunk, DiffLine, FilePatch } from '../types';

/**
 * 解析 unified diff（git diff / git show 的输出）。
 * 一个文本里可能有多个文件，先按 "diff --git" 切开。
 */
export function parsePatches(text: string): FilePatch[] {
  if (!text.trim()) return [];
  const parts = text.split(/^(?=diff --git )/m);
  const out: FilePatch[] = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    const patch = parseSingle(part);
    if (patch) out.push(patch);
  }
  return out;
}

function stripPrefix(p: string): string {
  const t = p.trim();
  if (t === '/dev/null') return t;
  if (t.startsWith('a/') || t.startsWith('b/')) return t.slice(2);
  return t;
}

function parseHunkHeader(line: string): {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
} | null {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!m) return null;
  return {
    oldStart: Number(m[1]),
    oldLines: m[2] === undefined ? 1 : Number(m[2]),
    newStart: Number(m[3]),
    newLines: m[4] === undefined ? 1 : Number(m[4]),
  };
}

function parseSingle(text: string): FilePatch | null {
  const rows = text.split(/\r?\n/);
  const patch: FilePatch = {
    oldPath: '',
    newPath: '',
    header: [],
    hunks: [],
    isBinary: false,
    isNew: false,
    isDeleted: false,
  };

  let cur: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const line of rows) {
    if (line.startsWith('diff --git ')) {
      patch.header.push(line);
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      if (m) {
        patch.oldPath = m[1];
        patch.newPath = m[2];
      }
      cur = null;
      continue;
    }

    if (line.startsWith('@@')) {
      const h = parseHunkHeader(line);
      if (!h) continue;
      cur = { header: line, ...h, lines: [] };
      patch.hunks.push(cur);
      oldNo = h.oldStart;
      newNo = h.newStart;
      continue;
    }

    if (!cur) {
      // hunk 之前的元信息
      if (line.startsWith('--- ')) {
        patch.oldPath = stripPrefix(line.slice(4));
        patch.header.push(line);
      } else if (line.startsWith('+++ ')) {
        patch.newPath = stripPrefix(line.slice(4));
        patch.header.push(line);
      } else if (line.startsWith('new file mode')) {
        patch.isNew = true;
        patch.header.push(line);
      } else if (line.startsWith('deleted file mode')) {
        patch.isDeleted = true;
        patch.header.push(line);
      } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
        patch.isBinary = true;
        patch.header.push(line);
      } else if (line.length > 0) {
        patch.header.push(line);
      }
      continue;
    }

    if (line.startsWith('\\')) {
      cur.lines.push({ kind: 'meta', text: line.slice(1).trim(), oldNo: null, newNo: null });
      continue;
    }
    if (line.length === 0) continue;

    const c = line[0];
    if (c === '+') {
      cur.lines.push({ kind: 'add', text: line.slice(1), oldNo: null, newNo });
      newNo += 1;
    } else if (c === '-') {
      cur.lines.push({ kind: 'del', text: line.slice(1), oldNo, newNo: null });
      oldNo += 1;
    } else if (c === ' ') {
      cur.lines.push({ kind: 'ctx', text: line.slice(1), oldNo, newNo });
      oldNo += 1;
      newNo += 1;
    }
    // 其他（例如 "diff --git" 之外的意外行）忽略
  }

  if (!patch.newPath) patch.newPath = patch.oldPath;
  if (!patch.oldPath) patch.oldPath = patch.newPath;
  if (!patch.header.length && !patch.hunks.length && !patch.isBinary) return null;
  return patch;
}

/** 未跟踪文件：git diff 看不到，用人造 patch 展示成"全新增"。 */
export function synthesizeAdded(text: string, path: string, truncated: boolean): FilePatch {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const diffLines: DiffLine[] = lines.map((t, i) => ({
    kind: 'add' as const,
    text: t,
    oldNo: null,
    newNo: i + 1,
  }));
  return {
    oldPath: '/dev/null',
    newPath: path,
    header: [truncated ? '未跟踪文件（内容已截断，仅显示前 2MB）' : '未跟踪文件'],
    hunks: [
      {
        header: `@@ -0,0 +1,${lines.length} @@ 新增文件`,
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: lines.length,
        lines: diffLines,
      },
    ],
    isBinary: false,
    isNew: true,
    isDeleted: false,
    synthetic: true,
  };
}
