import { useRef, useState } from 'react';
import { ChangesPanel } from './ChangesPanel';
import { DetailPanel } from './DetailPanel';
import { CommitList } from './CommitList';

const V_KEY = 'gitdesk.centerV';
const H_KEY = 'gitdesk.centerH';
const SPLITTER_PX = 5;

/** 垂直两段：提交图 / 下部（文件+差异）。图是主视图，默认占大头 */
const DEFAULT_V = [56, 44];
const MIN_V = [12, 20];
/** 水平两段：变更列表 / 差异视图 */
const DEFAULT_H = [30, 70];
const MIN_H = [14, 30];

function loadPair(key: string, fallback: number[], min: number[]): number[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const arr = JSON.parse(raw) as number[];
    if (
      Array.isArray(arr) &&
      arr.length === 2 &&
      arr.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
      arr[0] >= min[0] &&
      arr[1] >= min[1]
    ) {
      return arr;
    }
  } catch {
    /* 忽略坏数据 */
  }
  return fallback;
}

interface DragOpts {
  sizes: number[];
  min: number[];
  persist: (next: number[]) => void;
  apply: (next: number[]) => void;
  /** true = 拖垂直分隔条（调行高），false = 拖水平分隔条（调列宽） */
  axis: 'y' | 'x';
}

/**
 * 中间区域，对标 SmartGit Log Window 的结构：
 * 上方整宽的提交图（主视图），下方一行左右分列「变更列表 | 差异」。
 * 两条分隔条分别可拖拽，比例各自持久化；双击恢复默认。
 */
export function CenterStack() {
  const [vSizes, setVSizes] = useState(() => loadPair(V_KEY, DEFAULT_V, MIN_V));
  const [hSizes, setHSizes] = useState(() => loadPair(H_KEY, DEFAULT_H, MIN_H));
  const hostRef = useRef<HTMLDivElement | null>(null);

  const startDrag = (opts: DragOpts) => (e: React.MouseEvent) => {
    e.preventDefault();
    const host = hostRef.current;
    if (!host) return;

    const rect = host.getBoundingClientRect();
    const usable = (opts.axis === 'y' ? rect.height : rect.width) - SPLITTER_PX * 2;
    const start = [...opts.sizes];
    const sum = start[0] + start[1];
    const startXY = opts.axis === 'y' ? e.clientY : e.clientX;
    let latest = start;

    const onMove = (ev: MouseEvent) => {
      const delta = (((opts.axis === 'y' ? ev.clientY : ev.clientX) - startXY) / usable) * sum;
      let a = start[0] + delta;
      a = Math.max(opts.min[0], Math.min(sum - opts.min[1], a));
      latest = [a, sum - a];
      opts.apply(latest);
    };
    // 兜底：如果 mouseup 丢在窗口外，blur 也要收尾，避免拖拽状态卡死
    const stop = (commit: boolean) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onBlur);
      document.body.classList.remove('is-resizing');
      if (commit) opts.persist(latest);
    };
    const onUp = () => stop(true);
    const onBlur = () => stop(true);

    document.body.classList.add('is-resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onBlur);
  };

  const persistV = (next: number[]) => {
    try {
      localStorage.setItem(V_KEY, JSON.stringify(next));
    } catch {
      /* 忽略配额错误 */
    }
  };
  const persistH = (next: number[]) => {
    try {
      localStorage.setItem(H_KEY, JSON.stringify(next));
    } catch {
      /* 忽略配额错误 */
    }
  };

  const rows = [
    `minmax(120px, ${vSizes[0]}fr)`,
    `${SPLITTER_PX}px`,
    `minmax(160px, ${vSizes[1]}fr)`,
  ].join(' ');
  const cols = [
    `minmax(180px, ${hSizes[0]}fr)`,
    `${SPLITTER_PX}px`,
    `minmax(240px, ${hSizes[1]}fr)`,
  ].join(' ');

  return (
    <div className="stack" ref={hostRef} style={{ gridTemplateRows: rows }}>
      <section className="pane pane-history">
        <CommitList />
      </section>
      <div
        className="splitter"
        onMouseDown={startDrag({
          sizes: vSizes,
          min: MIN_V,
          persist: persistV,
          apply: setVSizes,
          axis: 'y',
        })}
        onDoubleClick={() => {
          setVSizes(DEFAULT_V);
          persistV(DEFAULT_V);
        }}
        title="拖动调整提交图高度 · 双击恢复默认"
      />
      <div className="bottom-split" style={{ gridTemplateColumns: cols }}>
        <section className="pane">
          <ChangesPanel />
        </section>
        <div
          className="splitter hsplit"
          onMouseDown={startDrag({
            sizes: hSizes,
            min: MIN_H,
            persist: persistH,
            apply: setHSizes,
            axis: 'x',
          })}
          onDoubleClick={() => {
            setHSizes(DEFAULT_H);
            persistH(DEFAULT_H);
          }}
          title="拖动调整列表宽度 · 双击恢复默认"
        />
        <section className="pane">
          <DetailPanel />
        </section>
      </div>
    </div>
  );
}
