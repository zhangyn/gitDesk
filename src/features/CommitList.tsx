import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { drawGraph, graphWidthFor, ROW_HEIGHT } from './graph/drawGraph';

const DATE_FMT = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** 距离底部多少像素就开始加载下一页 */
const LOAD_MORE_THRESHOLD = 320;
const MORE_BAR_HEIGHT = 34;

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
  const logQuery = useStore((s) => s.logQuery);
  const setLogQuery = useStore((s) => s.setLogQuery);
  const clearLogQuery = useStore((s) => s.clearLogQuery);
  const logLimit = useStore((s) => s.logLimit);
  const loadMoreLog = useStore((s) => s.loadMoreLog);
  const busy = useStore((s) => s.busy);

  const [searchMode, setSearchMode] = useState<'message' | 'path'>('message');
  const [searchText, setSearchText] = useState('');

  // 输入防抖：停下 350ms 才真正打 git
  useEffect(() => {
    const current = logQuery && logQuery.mode === searchMode ? logQuery.text : '';
    if (searchText.trim() === current) return;
    const t = setTimeout(() => setLogQuery(searchMode, searchText), 350);
    return () => clearTimeout(t);
  }, [searchText, searchMode, logQuery, setLogQuery]);

  const [hover, setHover] = useState(-1);
  // 满了这一页就可能还有下一页
  const hasMore = commits.length >= logLimit;
  const [viewWidth, setViewWidth] = useState(0);
  const [viewHeight, setViewHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    loadingMoreRef.current = false;
  }, [logLimit]);

  /**
   * 用 ref 回调而不是 useEffect 来测量尺寸：
   * 首帧 graph 为空时不会渲染 .commit-scroll，effect 里拿不到节点就再也不会重新测量
   * （表现为画布一直停在 canvas 默认的 300x150）。ref 回调在节点真正挂载时才会被调用。
   */
  const roRef = useRef<ResizeObserver | null>(null);
  const attachScroll = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const measure = () => {
      setViewWidth(el.clientWidth);
      setViewHeight(el.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
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
  const rowsHeight = Math.max(ROW_HEIGHT, graph.length * ROW_HEIGHT);
  const innerHeight = rowsHeight + (hasMore ? MORE_BAR_HEIGHT : 0);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewWidth === 0 || viewHeight === 0) return;
    drawGraph(canvas, graph, {
      width: viewWidth,
      graphWidth: width,
      viewportHeight: viewHeight,
      scrollTop,
      selectedIndex,
      hoverIndex: hover,
    });
  }, [graph, width, viewWidth, viewHeight, scrollTop, selectedIndex, hover]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    if (
      hasMore &&
      !loadingMoreRef.current &&
      busy === null &&
      el.scrollTop + el.clientHeight >= rowsHeight - LOAD_MORE_THRESHOLD
    ) {
      loadingMoreRef.current = true;
      void loadMoreLog();
    }
  }, [hasMore, busy, rowsHeight, loadMoreLog]);

  const head = (
    <div className="pane-head">
      <span>提交历史</span>
      <span className="count">{commits.length}</span>
      {hasMore && <span className="hint">还有更多</span>}
      {logQuery && <span className="badge badge-head">搜索结果</span>}
      <span className="spacer" />
      <div className="log-search">
        <select
          className="mini-select"
          value={searchMode}
          onChange={(e) => setSearchMode(e.target.value as 'message' | 'path')}
          title="搜索目标"
        >
          <option value="message">说明</option>
          <option value="path">文件</option>
        </select>
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder={searchMode === 'message' ? '搜提交说明…' : '搜文件路径…'}
          spellCheck={false}
        />
        {(searchText || logQuery) && (
          <button
            className="icon-btn"
            title="清除搜索"
            onClick={() => {
              setSearchText('');
              clearLogQuery();
            }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );

  if (graph.length === 0) {
    return (
      <>
        {head}
        <div className="empty-hint">{logQuery ? '没有匹配的提交' : '这个仓库还没有提交'}</div>
      </>
    );
  }

  return (
    <>
      {head}
      <div className="commit-wrap">
        <canvas ref={canvasRef} className="commit-canvas" />
        <div className="commit-scroll" ref={attachScroll} onScroll={onScroll}>
          <div className="commit-inner" style={{ height: innerHeight }}>
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

            {hasMore && (
              <div className="commit-more" style={{ top: rowsHeight }}>
                {busy ? (
                  <span className="hint">加载中…</span>
                ) : (
                  <button
                    className="btn small"
                    onClick={() => void loadMoreLog()}
                    title={`再加载 ${logLimit} 条`}
                  >
                    加载更多（已加载 {commits.length} 条）
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
