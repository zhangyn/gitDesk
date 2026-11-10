import { useEffect, useRef, useState } from 'react';

/**
 * 差异块（hunk）上下跳转。
 *
 * 中间面板和双击弹出的大窗都用它，行为保持一致：
 * - 计数显示 `当前/总数`
 * - 滚动到目标块时用 center 对齐，长文件也能立刻看到上下文
 * - 换了文件/提交（resetKey 变化）自动回到第 1 块
 */
export function useHunkNav(count: number, resetKey?: unknown) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [resetKey, count]);

  const go = (delta: number) => {
    const root = containerRef.current;
    if (!root) return;
    const heads = root.querySelectorAll<HTMLElement>('.hunk-head');
    if (heads.length === 0) return;
    const next = Math.max(0, Math.min(heads.length - 1, index + delta));
    setIndex(next);
    heads[next].scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  return { containerRef, index, go };
}

export function HunkNav({
  count,
  index,
  onGo,
}: {
  count: number;
  index: number;
  onGo: (delta: number) => void;
}) {
  if (count === 0) return null;
  return (
    <span className="hunk-nav" title="上一个 / 下一个差异块">
      <span className="hunk-nav-count">
        {Math.min(index + 1, count)}/{count}
      </span>
      <button className="icon-btn" title="上一个差异块" onClick={() => onGo(-1)}>
        ↑
      </button>
      <button className="icon-btn" title="下一个差异块" onClick={() => onGo(1)}>
        ↓
      </button>
    </span>
  );
}
