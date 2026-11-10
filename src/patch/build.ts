import type { DiffHunk, FilePatch, Side } from '../types';

/**
 * 从「已解析的 diff」重新构造一个只包含选中改动的 patch。
 *
 * 为什么必须重新构造而不是裁剪原 patch：
 *  - 行级选择时，未选中的 `-` 行必须**变回上下文行**（因为它在 index 里还在），
 *    否则 git apply 会认为要删除它。
 *  - 未选中的 `+` 行直接丢弃。
 *  - hunk 头的行数必须重算，且后续 hunk 的 newStart 要按前面的净增量偏移。
 *
 * 这个文件是纯函数，不碰 git、不碰 fs，可以直接单测。
 */

/**
 * 选择集 key。带上 side，是因为同一个文件可能同时有「未暂存」和「已暂存」两份 diff，
 * 两份的行索引会撞车。
 */
export function lineKey(
  patchIndex: number,
  hunkIndex: number,
  lineIndex: number,
  side: Side = 'worktree',
): string {
  return `${side}:${patchIndex}:${hunkIndex}:${lineIndex}`;
}

export function isSelectable(kind: string): boolean {
  return kind === 'add' || kind === 'del';
}

/** 所有可选的（add/del）行的 key，用于「全选」 */
export function allSelectableKeys(patches: FilePatch[], side: Side = 'worktree'): string[] {
  const keys: string[] = [];
  patches.forEach((p, pi) =>
    p.hunks.forEach((h, hi) =>
      h.lines.forEach((l, li) => {
        if (isSelectable(l.kind)) keys.push(lineKey(pi, hi, li, side));
      }),
    ),
  );
  return keys;
}

export function hunkKeys(
  patchIndex: number,
  hunkIndex: number,
  hunk: DiffHunk,
  side: Side = 'worktree',
): string[] {
  const keys: string[] = [];
  hunk.lines.forEach((l, li) => {
    if (isSelectable(l.kind)) keys.push(lineKey(patchIndex, hunkIndex, li, side));
  });
  return keys;
}

function headerFor(
  patch: FilePatch,
  flags: { fullNew: boolean; fullDelete: boolean },
): string[] {
  const lines: string[] = [];
  const aPath = flags.fullNew ? patch.newPath : patch.oldPath;
  const bPath = flags.fullDelete ? patch.oldPath : patch.newPath;
  lines.push(`diff --git a/${aPath} b/${bPath}`);

  // git apply 靠这两个 mode 行把 patch 识别为「新建 / 删除」，
  // 只靠 --- /dev/null 不够（实测会报 dev/null: does not exist in index）。
  if (patch.isNew) lines.push('new file mode 100644');
  if (flags.fullDelete) lines.push('deleted file mode 100644');

  // 刻意不输出 index 行：避免 git apply 校验 blob 哈希（我们只搬运内容）。
  // 代价是 M2 不支持把「文件权限变更」单独暂存。
  lines.push(patch.isNew ? '--- /dev/null' : `--- a/${aPath}`);
  lines.push(flags.fullDelete ? '+++ /dev/null' : `+++ b/${bPath}`);
  return lines;
}

function buildFile(
  patch: FilePatch,
  patchIndex: number,
  selection: Set<string>,
  side: Side,
): { text: string; count: number } {
  const out: string[] = [];
  let delta = 0;
  let count = 0;

  for (let hi = 0; hi < patch.hunks.length; hi++) {
    const hunk = patch.hunks[hi];
    const rows: string[] = [];
    let oldLines = 0;
    let newLines = 0;
    let chosen = 0;
    let lastEmitted = false;
    let prevRawKind = '';
    let swallowNextMeta = false;

    for (let li = 0; li < hunk.lines.length; li++) {
      const line = hunk.lines[li];

      if (line.kind === 'meta') {
        // "\ No newline at end of file" 只对「新侧的最后一行」有意义。
        // 如果它是跟在一行刚被降级为上下文的 `-` 后面，就必须丢掉，
        // 否则 git 会把下一个 + 行粘到这一行末尾（实测会变成 betagamma）。
        if (swallowNextMeta) {
          swallowNextMeta = false;
          continue;
        }
        const isLastHunkLine = hi === patch.hunks.length - 1 && li === hunk.lines.length - 1;
        if (lastEmitted && prevRawKind === 'add') {
          rows.push('\\ No newline at end of file');
        } else if (lastEmitted && prevRawKind === 'ctx' && isLastHunkLine) {
          rows.push('\\ No newline at end of file');
        }
        continue;
      }

      if (line.kind === 'ctx') {
        rows.push(` ${line.text}`);
        oldLines += 1;
        newLines += 1;
        lastEmitted = true;
        prevRawKind = 'ctx';
        continue;
      }

      const on = selection.has(lineKey(patchIndex, hi, li, side));

      if (line.kind === 'add') {
        if (on) {
          rows.push(`+${line.text}`);
          newLines += 1;
          chosen += 1;
          lastEmitted = true;
          prevRawKind = 'add';
        }
        // 未选中的新增行：丢弃（它在 base 里本来就不存在）
      } else if (line.kind === 'del') {
        if (on) {
          rows.push(`-${line.text}`);
          oldLines += 1;
          chosen += 1;
          lastEmitted = true;
          prevRawKind = 'del';
        } else {
          const nextIsMeta = hunk.lines[li + 1]?.kind === 'meta';
          if (nextIsMeta) {
            // 这一行是「老侧的最后一行且没有尾换行」，而我们不想删它。
            // 上下文行无法表达「两侧行尾不同」，所以必须删掉再原样加回来。
            rows.push(`-${line.text}`);
            rows.push('\\ No newline at end of file');
            rows.push(`+${line.text}`);
            oldLines += 1;
            newLines += 1;
            lastEmitted = true;
            prevRawKind = 'del-readded';
            swallowNextMeta = true;
          } else {
            // 未选中的删除行：降级成上下文行（index 里还留着它）
            rows.push(` ${line.text}`);
            oldLines += 1;
            newLines += 1;
            lastEmitted = true;
            prevRawKind = 'del-downgraded';
          }
        }
      }
    }

    if (chosen === 0) continue; // 整块没选中 → 整块不输出

    count += chosen;
    const newStart = hunk.oldStart + delta;
    out.push(`@@ -${hunk.oldStart},${oldLines} +${newStart},${newLines} @@`);
    out.push(...rows);
    delta += newLines - oldLines;
  }

  if (count === 0) return { text: '', count: 0 };

  // 部分暂存一个「删除文件」时不能带 deleted file mode，否则 git apply 会报
  // "removal patch leaves file contents"。此时按普通修改处理。
  let fullDelete = false;
  if (patch.isDeleted) {
    let totalDel = 0;
    let selectedDel = 0;
    patch.hunks.forEach((h, hi) =>
      h.lines.forEach((l, li) => {
        if (l.kind !== 'del') return;
        totalDel += 1;
        if (selection.has(lineKey(patchIndex, hi, li, side))) selectedDel += 1;
      }),
    );
    fullDelete = totalDel > 0 && totalDel === selectedDel;
  }

  const header = headerFor(patch, { fullNew: patch.isNew, fullDelete });
  return { text: `${[...header, ...out].join('\n')}\n`, count };
}

/** 多文件拼接成一个 patch 文本，可直接喂给 `git apply` */
export function buildSelectedPatch(
  patches: FilePatch[],
  selection: Set<string>,
  side: Side = 'worktree',
): { patch: string; count: number } {
  const parts: string[] = [];
  let count = 0;
  patches.forEach((p, pi) => {
    const r = buildFile(p, pi, selection, side);
    if (r.text) {
      parts.push(r.text);
      count += r.count;
    }
  });
  return { patch: parts.join(''), count };
}
