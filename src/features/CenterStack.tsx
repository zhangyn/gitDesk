import { useRef, useState } from 'react';
import { ChangesPanel } from './ChangesPanel';
import { DetailPanel } from './DetailPanel';
import { CommitList } from './CommitList';

const KEY = 'gitdesk.paneSizes';
/** 三段的初始比例（fr），和固定像素最小高度配合使用 */
const DEFAULT_SIZES = [24, 46, 30];
const MIN_FR = [8, 14, 12];
const SPLITTER_PX = 5;

function loadSizes(): number[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SIZES;
    const arr = JSON.parse(raw) as number[];
    if (!Array.isArray(arr) || arr.length !== 3 || arr.some((n) => typeof n !== 'number')) {
      return DEFAULT_SIZES;
    }
    return arr;
  } catch {
    return DEFAULT_SIZES;
  }
}

/**
 * 中间区域：上「变更」/ 中「差异」/ 下「提交历史」，两条分隔条可拖拽调整比例。
 * 比例持久化在 localStorage，下次打开还是你调好的样子。
 */
export function CenterStack() {
  const [sizes, setSizes] = useState<number[]>(loadSizes);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const persist = (next: number[]) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* 忽略配额错误 */
    }
  };

  const startDrag = (index: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    const host = hostRef.current;
    if (!host) return;

    const rect = host.getBoundingClientRect();
    const usable = rect.height - SPLITTER_PX * 2;
    const startY = e.clientY;
    const start = [...sizes];
    const sum = start.reduce((a, b) => a + b, 0);
    const pair = start[index] + start[index + 1];

    const onMove = (ev: MouseEvent) => {
      const deltaFr = ((ev.clientY - startY) / usable) * sum;
      let a = start[index] + deltaFr;
      a = Math.max(MIN_FR[index], Math.min(pair - MIN_FR[index + 1], a));
      const next = [...start];
      next[index] = a;
      next[index + 1] = pair - a;
      latestRef.current = next;
      setSizes(next);
    };
    // 兜底：如果 mouseup 丢在窗口外，mouseleave / blur 也要收尾，避免拖拽状态卡死
    const stop = (commit: boolean) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onBlur);
      document.body.classList.remove('is-resizing');
      if (commit) persist(latestRef.current);
    };
    const onUp = () => stop(true);
    const onBlur = () => stop(true);

    const latestRef = { current: start };
    document.body.classList.add('is-resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onBlur);
  };

  const rows = [
    `minmax(70px, ${sizes[0]}fr)`,
    `${SPLITTER_PX}px`,
    `minmax(120px, ${sizes[1]}fr)`,
    `${SPLITTER_PX}px`,
    `minmax(90px, ${sizes[2]}fr)`,
  ].join(' ');

  return (
    <div className="stack" ref={hostRef} style={{ gridTemplateRows: rows }}>
      <section className="pane">
        <ChangesPanel />
      </section>
      <div
        className="splitter"
        onMouseDown={startDrag(0)}
        onDoubleClick={() => {
          setSizes(DEFAULT_SIZES);
          persist(DEFAULT_SIZES);
        }}
        title="拖动调整高度 · 双击恢复默认"
      />
      <section className="pane">
        <DetailPanel />
      </section>
      <div
        className="splitter"
        onMouseDown={startDrag(1)}
        onDoubleClick={() => {
          setSizes(DEFAULT_SIZES);
          persist(DEFAULT_SIZES);
        }}
        title="拖动调整高度 · 双击恢复默认"
      />
      <section className="pane pane-history">
        <CommitList />
      </section>
    </div>
  );
}
