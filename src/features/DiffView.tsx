import type { DiffLine, DiffHunk, FilePatch, Side } from '../types';
import { useStore } from '../store';
import { hunkKeys, isSelectable, lineKey } from '../patch/build';

export type DiffMode = 'split' | 'unified';

function sign(kind: string): string {
  if (kind === 'add') return '+';
  if (kind === 'del') return '-';
  if (kind === 'meta') return '\\';
  return '';
}

interface Cell {
  line: DiffLine;
  index: number;
}

interface SplitRow {
  left?: Cell;
  right?: Cell;
  meta?: Cell;
}

/**
 * 把 unified hunk 转成左右两栏：连续的 del/add 块按位对齐，
 * 与 SmartGit / Fork 的分栏行为一致。
 */
function toSplitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  const lines = hunk.lines;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.kind === 'meta') {
      rows.push({ meta: { line, index: i } });
      i += 1;
      continue;
    }
    if (line.kind === 'ctx') {
      rows.push({ left: { line, index: i }, right: { line, index: i } });
      i += 1;
      continue;
    }

    const dels: Cell[] = [];
    const adds: Cell[] = [];
    while (i < lines.length && (lines[i].kind === 'del' || lines[i].kind === 'add')) {
      const c = { line: lines[i], index: i };
      if (lines[i].kind === 'del') dels.push(c);
      else adds.push(c);
      i += 1;
    }
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) rows.push({ left: dels[k], right: adds[k] });
  }
  return rows;
}

function cellClass(cell: Cell | undefined, selectable: boolean, isSel: boolean): string {
  if (!cell) return 'dsp-cell empty';
  const kind = cell.line.kind;
  return `dsp-cell ${kind}${selectable ? ' selectable' : ''}${isSel ? ' is-sel' : ''}`;
}

function SplitView({
  patch,
  pi,
  interactive,
  side,
}: {
  patch: FilePatch;
  pi: number;
  interactive: boolean;
  side: Side;
}) {
  const selection = useStore((s) => s.selection);
  const toggleKeys = useStore((s) => s.toggleKeys);

  const cell = (c: Cell | undefined, which: 'old' | 'new', hi: number) => {
    if (!c) return <div className="dsp-cell empty" />;
    const selectable = interactive && isSelectable(c.line.kind);
    const key = lineKey(pi, hi, c.index, side);
    const sel = selectable && selection.has(key);
    const no = which === 'old' ? c.line.oldNo : c.line.newNo;
    return (
      <div
        className={cellClass(c, selectable, sel)}
        onClick={() => {
          if (selectable) toggleKeys([key]);
        }}
      >
        <span className="ln">{no ?? ''}</span>
        <span className="sign">{sign(c.line.kind)}</span>
        <span className="txt" title={c.line.text}>
          {c.line.text.length > 0 ? c.line.text : '\u00a0'}
        </span>
      </div>
    );
  };

  return (
    <>
      {patch.hunks.map((hunk, hi) => {
        const rows = toSplitRows(hunk);
        // 分栏模式下 hunk 选择仍按「块」操作
        const keys = hunkKeys(pi, hi, hunk, side);
        const selCount = keys.filter((k) => selection.has(k)).length;
        const allSel = keys.length > 0 && selCount === keys.length;
        const someSel = selCount > 0 && !allSel;

        return (
          <div className="hunk" key={hi}>
            <div
              className={`hunk-head${interactive && keys.length > 0 ? ' interactive' : ''}${
                allSel ? ' is-sel' : someSel ? ' is-partial' : ''
              }`}
              onClick={() => {
                if (interactive && keys.length > 0) toggleKeys(keys);
              }}
              title={interactive ? '点击选中/取消整块' : undefined}
            >
              {interactive && keys.length > 0 && (
                <span className="selbox">{allSel ? '◼' : someSel ? '◧' : '◻'}</span>
              )}
              <span className="hh mono">{hunk.header}</span>
            </div>

            {rows.map((row, ri) => {
              if (row.meta) {
                return (
                  <div className="dsp-meta" key={ri}>
                    \ {row.meta.line.text}
                  </div>
                );
              }
              return (
                <div className="dsp-row" key={ri}>
                  {cell(row.left, 'old', hi)}
                  <div className="dsp-divider" />
                  {cell(row.right, 'new', hi)}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function UnifiedView({
  patch,
  pi,
  interactive,
  side,
}: {
  patch: FilePatch;
  pi: number;
  interactive: boolean;
  side: Side;
}) {
  const selection = useStore((s) => s.selection);
  const toggleKeys = useStore((s) => s.toggleKeys);

  return (
    <>
      {patch.hunks.map((hunk, hi) => {
        const keys = hunkKeys(pi, hi, hunk, side);
        const selCount = keys.filter((k) => selection.has(k)).length;
        const allSel = keys.length > 0 && selCount === keys.length;
        const someSel = selCount > 0 && !allSel;

        return (
          <div className="hunk" key={hi}>
            <div
              className={`hunk-head${interactive && keys.length > 0 ? ' interactive' : ''}${
                allSel ? ' is-sel' : someSel ? ' is-partial' : ''
              }`}
              onClick={() => {
                if (interactive && keys.length > 0) toggleKeys(keys);
              }}
              title={interactive ? '点击选中/取消整块' : undefined}
            >
              {interactive && keys.length > 0 && (
                <span className="selbox">{allSel ? '◼' : someSel ? '◧' : '◻'}</span>
              )}
              <span className="hh mono">{hunk.header}</span>
            </div>

            {hunk.lines.map((line, li) => {
              const selectable = interactive && isSelectable(line.kind);
              const key = lineKey(pi, hi, li, side);
              const sel = selection.has(key);
              return (
                <div
                  key={li}
                  className={`dl ${line.kind}${sel ? ' is-sel' : ''}${
                    selectable ? ' selectable' : ''
                  }`}
                  onClick={() => {
                    if (selectable) toggleKeys([key]);
                  }}
                >
                  {interactive && <span className="selbox">{sel ? '▪' : ''}</span>}
                  <span className="ln">{line.oldNo ?? ''}</span>
                  <span className="ln">{line.newNo ?? ''}</span>
                  <span className="sign">{sign(line.kind)}</span>
                  <span className="txt">{line.text.length > 0 ? line.text : '\u00a0'}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

export function DiffView({
  patches,
  loading,
  hasTarget,
  interactive,
  side,
  mode,
  emptyText,
}: {
  patches: FilePatch[];
  loading: boolean;
  hasTarget: boolean;
  interactive: boolean;
  side: Side;
  mode: DiffMode;
  emptyText?: string;
}) {
  if (loading) return <div className="diff-empty">加载中…</div>;
  if (!hasTarget) return <div className="diff-empty">选择左侧的提交或文件查看差异</div>;
  if (patches.length === 0) return <div className="diff-empty">{emptyText ?? '没有可显示的差异'}</div>;

  return (
    <div className={`diff${mode === 'split' ? ' is-split' : ''}`}>
      {patches.map((p, pi) => (
        <div className="diff-file" key={`${p.newPath}-${pi}`}>
          {/* 只有一个文件时，路径已经在面板标题里了，不要再重复一遍 */}
          {patches.length > 1 && (
          <div className="diff-file-head">
            <span className="mono path">{p.newPath}</span>
            {p.isNew && <span className="badge badge-add">新增</span>}
            {p.isDeleted && <span className="badge badge-del">删除</span>}
            {p.isBinary && <span className="badge">二进制</span>}
            {p.synthetic && <span className="badge">未跟踪</span>}
          </div>
          )}

          {p.isBinary && p.hunks.length === 0 && (
            <div className="diff-empty small">二进制文件不展示内容</div>
          )}

          {mode === 'split' ? (
            <SplitView patch={p} pi={pi} interactive={interactive} side={side} />
          ) : (
            <UnifiedView patch={p} pi={pi} interactive={interactive} side={side} />
          )}
        </div>
      ))}
    </div>
  );
}
