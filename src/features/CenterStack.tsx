import { useRef, useState } from 'react';
import { useStore } from '../store';
import { ChangesPanel } from './ChangesPanel';
import { DetailPanel } from './DetailPanel';
import { CommitList } from './CommitList';

const SPLITTER_PX = 5;

/** 布局一/二的两段垂直比例：提交图 / （文件|差异） */
const V_KEY = 'gitdesk.centerV';
const DEFAULT_V = [56, 44];
const MIN_V = [12, 20];
/** 布局一/二的水平比例：变更列表 / 差异 */
const H_KEY = 'gitdesk.centerH';
const DEFAULT_H = [30, 70];
const MIN_H = [14, 30];
/** 布局三（经典三行）：变更 / 差异 / 提交图 */
const S3_KEY = 'gitdesk.centerStack3';
const DEFAULT_3 = [24, 46, 30];
const MIN_3 = [8, 14, 12];

function loadArr(key: string, len: number, fallback: number[], min: number[]): number[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const arr = JSON.parse(raw) as unknown;
    if (
      Array.isArray(arr) &&
      arr.length === len &&
      arr.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
      arr.every((n, i) => n >= min[i])
    ) {
      return arr;
    }
  } catch {
    /* 忽略坏数据 */
  }
  return fallback;
}

function persistArr(key: string, value: number[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 忽略配额错误 */
  }
}

interface DragSpec {
  sizes: number[];
  min: number[];
  /** 调整哪一对相邻段 */
  index: number;
  axis: 'y' | 'x';
  apply: (next: number[]) => void;
  persistFn: (next: number[]) => void;
}

/**
 * 中间区域，三种可选布局（工具栏「更多」菜单切换，各自比例独立持久化）：
 * - graph-top：提交图在上（整宽），下面一行「变更 | 差异」左右分列 —— 默认，对标 SmartGit Log Window
 * - graph-bottom：同上但上下翻转（文件|差异在上，图在下）
 * - stacked：经典三行——变更 / 差异 / 提交图
 */
export function CenterStack() {
  const layout = useStore((s) => s.centerLayout);
  const [vSizes, setVSizes] = useState(() => loadArr(V_KEY, 2, DEFAULT_V, MIN_V));
  const [hSizes, setHSizes] = useState(() => loadArr(H_KEY, 2, DEFAULT_H, MIN_H));
  const [sizes3, setSizes3] = useState(() => loadArr(S3_KEY, 3, DEFAULT_3, MIN_3));
  const hostRef = useRef<HTMLDivElement | null>(null);

  /** 拖拽任意一条分隔条：只改相邻两段的比例，其余段不动 */
  const startDrag = (spec: DragSpec) => (e: React.MouseEvent) => {
    e.preventDefault();
    const host = hostRef.current;
    if (!host) return;

    const rect = host.getBoundingClientRect();
    const splitters = spec.sizes.length - 1;
    const usable = (spec.axis === 'y' ? rect.height : rect.width) - SPLITTER_PX * splitters;
    const start = [...spec.sizes];
    const sum = start.reduce((a, b) => a + b, 0);
    const pair = start[spec.index] + start[spec.index + 1];
    const startXY = spec.axis === 'y' ? e.clientY : e.clientX;
    let latest = start;

    const onMove = (ev: MouseEvent) => {
      const delta = (((spec.axis === 'y' ? ev.clientY : ev.clientX) - startXY) / usable) * sum;
      let a = start[spec.index] + delta;
      a = Math.max(spec.min[spec.index], Math.min(pair - spec.min[spec.index + 1], a));
      const next = [...start];
      next[spec.index] = a;
      next[spec.index + 1] = pair - a;
      latest = next;
      spec.apply(next);
    };
    // 兜底：如果 mouseup 丢在窗口外，blur 也要收尾，避免拖拽状态卡死
    const stop = (commit: boolean) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onBlur);
      document.body.classList.remove('is-resizing');
      if (commit) spec.persistFn(latest);
    };
    const onUp = () => stop(true);
    const onBlur = () => stop(true);

    document.body.classList.add('is-resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onBlur);
  };

  /* ---------------- 三种布局的共享片段 ---------------- */

  const filesDiffSplit = (
    <>
      <section className="pane">
        <ChangesPanel />
      </section>
      <div
        className="splitter hsplit"
        onMouseDown={startDrag({
          sizes: hSizes,
          min: MIN_H,
          index: 0,
          axis: 'x',
          apply: setHSizes,
          persistFn: (n) => persistArr(H_KEY, n),
        })}
        onDoubleClick={() => {
          setHSizes(DEFAULT_H);
          persistArr(H_KEY, DEFAULT_H);
        }}
        title="拖动调整列表宽度 · 双击恢复默认"
      />
      <section className="pane">
        <DetailPanel />
      </section>
    </>
  );

  const bottomSplit = (
    <div
      className="bottom-split"
      style={{ gridTemplateColumns: `${hSizes[0]}fr ${SPLITTER_PX}px ${hSizes[1]}fr` }}
    >
      {filesDiffSplit}
    </div>
  );

  const graphPane = (
    <section className="pane pane-history">
      <CommitList />
    </section>
  );

  /* ---------------- 经典三行 ---------------- */

  if (layout === 'stacked') {
    const rows = [
      `minmax(70px, ${sizes3[0]}fr)`,
      `${SPLITTER_PX}px`,
      `minmax(120px, ${sizes3[1]}fr)`,
      `${SPLITTER_PX}px`,
      `minmax(90px, ${sizes3[2]}fr)`,
    ].join(' ');
    return (
      <div className="stack" ref={hostRef} style={{ gridTemplateRows: rows }}>
        <section className="pane">
          <ChangesPanel />
        </section>
        <div
          className="splitter"
          onMouseDown={startDrag({
            sizes: sizes3,
            min: MIN_3,
            index: 0,
            axis: 'y',
            apply: setSizes3,
            persistFn: (n) => persistArr(S3_KEY, n),
          })}
          onDoubleClick={() => {
            setSizes3(DEFAULT_3);
            persistArr(S3_KEY, DEFAULT_3);
          }}
          title="拖动调整高度 · 双击恢复默认"
        />
        <section className="pane">
          <DetailPanel />
        </section>
        <div
          className="splitter"
          onMouseDown={startDrag({
            sizes: sizes3,
            min: MIN_3,
            index: 1,
            axis: 'y',
            apply: setSizes3,
            persistFn: (n) => persistArr(S3_KEY, n),
          })}
          onDoubleClick={() => {
            setSizes3(DEFAULT_3);
            persistArr(S3_KEY, DEFAULT_3);
          }}
          title="拖动调整高度 · 双击恢复默认"
        />
        <section className="pane pane-history">
          <CommitList />
        </section>
      </div>
    );
  }

  /* ---------------- 图在上 / 图在下（两行） ---------------- */

  const rows = [
    `minmax(120px, ${vSizes[0]}fr)`,
    `${SPLITTER_PX}px`,
    `minmax(160px, ${vSizes[1]}fr)`,
  ].join(' ');
  const top = layout === 'graph-top' ? graphPane : bottomSplit;
  const bottom = layout === 'graph-top' ? bottomSplit : graphPane;

  return (
    <div className="stack" ref={hostRef} style={{ gridTemplateRows: rows }}>
      {top}
      <div
        className="splitter"
        onMouseDown={startDrag({
          sizes: vSizes,
          min: MIN_V,
          index: 0,
          axis: 'y',
          apply: setVSizes,
          persistFn: (n) => persistArr(V_KEY, n),
        })}
        onDoubleClick={() => {
          setVSizes(DEFAULT_V);
          persistArr(V_KEY, DEFAULT_V);
        }}
        title="拖动调整高度 · 双击恢复默认"
      />
      {bottom}
    </div>
  );
}
