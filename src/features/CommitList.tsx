import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { drawGraph, graphWidthFor, ROW_HEIGHT } from './graph/drawGraph';

const DATE_FMT = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function refClass(ref: string): string {
  if (ref.startsWith('HEAD')) return 'badge badge-head';
  if (ref.startsWith('tag:')) return 'badge badge-tag';
  if (ref.includes('/')) return 'badge badge-remote';
  return 'badge badge-branch';
}

export function CommitList() {
  const commits = useStore((s) => s.commits);
  const graph = useStore((s) => s.graph);
  const selectedSha = useStore((s) => s.selectedSha);
  const openCommit = useStore((s) => s.openCommit);
  const [hover, setHover] = useState(-1);
  const [viewWidth, setViewWidth] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 画布要铺满整行宽度，才能画出整行的选中底色
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 行以 graph 为准（泳道布局是渲染的真源），提交数据按 sha 查表，
  // 避免 layoutGraph 跳过重复 sha 时出现索引错位。
  const bySha = useMemo(() => {
    const map = new Map<string, (typeof commits)[number]>();
    for (const c of commits) map.set(c.sha, c);
    return map;
  }, [commits]);

  const width = useMemo(() => graphWidthFor(graph), [graph]);
  const selectedIndex = useMemo(
    () => (selectedSha ? graph.findIndex((r) => r.sha === selectedSha) : -1),
    [graph, selectedSha],
  );
  const height = Math.max(ROW_HEIGHT, graph.length * ROW_HEIGHT);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawGraph(canvas, graph, {
      width: Math.max(viewWidth, width),
      graphWidth: width,
      height,
      selectedIndex,
      hoverIndex: hover,
    });
  }, [graph, width, height, viewWidth, selectedIndex, hover]);

  const head = (
    <div className="pane-head">
      <span>提交历史</span>
      <span className="count">{commits.length}</span>
      <span className="spacer" />
      <span className="hint">F5 刷新 · Ctrl+K 提交</span>
    </div>
  );

  if (graph.length === 0) {
    return (
      <>
        {head}
        <div className="empty-hint">这个仓库还没有提交</div>
      </>
    );
  }

  return (
    <>
      {head}
      <div className="commit-scroll" ref={scrollRef}>
      <div className="commit-inner" style={{ height }}>
        <canvas ref={canvasRef} className="commit-canvas" />
        {graph.map((row, i) => {
          const c = bySha.get(row.sha);
          if (!c) return null;
          return (
            <div
              key={`${row.sha}-${i}`}
              className={`commit-row${i === selectedIndex ? ' is-selected' : ''}`}
              style={{ top: i * ROW_HEIGHT, paddingLeft: width + 6 }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(-1)}
              onClick={() => void openCommit(c.sha)}
            >
              {c.refs.length > 0 && (
                <span className="refs" title={c.refs.join(' · ')}>
                  {c.refs.map((r) => (
                    <span key={r} className={refClass(r)}>
                      {r.replace('tag: ', '')}
                    </span>
                  ))}
                </span>
              )}
              <span className="subject" title={c.subject}>
                {c.subject}
              </span>
              <span className="author">{c.authorName}</span>
              <span className="date">{DATE_FMT.format(new Date(c.authorDate * 1000))}</span>
              <span className="sha mono">{shortSha(c.sha)}</span>
            </div>
          );
        })}
      </div>
      </div>
    </>
  );
}
