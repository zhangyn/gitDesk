import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { drawGraph, graphWidthFor, ROW_HEIGHT } from './graph/drawGraph';
import { copyText } from '../ui/clipboard';
import { ContextMenu, type CtxItem } from '../ui/ContextMenu';
import { promptBox } from '../ui/dialog';

const DATE_FMT = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** 距离底部多少像素就开始加载下一页 */
const LOAD_MORE_THRESHOLD = 320;
const MORE_BAR_HEIGHT = 34;
/** DOM 行虚拟化：视口外上下各多渲染几行，滚动时不露白 */
const OVERSCAN = 10;

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
  const openDiffModal = useStore((s) => s.openDiffModal);
  const busy = useStore((s) => s.busy);
  const cherryPickOp = useStore((s) => s.cherryPickOp);
  const revertOp = useStore((s) => s.revertOp);
  const resetToOp = useStore((s) => s.resetToOp);
  const bisectStartOp = useStore((s) => s.bisectStartOp);
  const bisectMarkOp = useStore((s) => s.bisectMarkOp);
  const bisecting = useStore((s) => s.bisecting);
  const createBranchAtOp = useStore((s) => s.createBranchAtOp);
  const createTagOp = useStore((s) => s.createTagOp);

  /** 右键菜单的锚点：屏幕坐标 + 目标提交 */
  const [ctx, setCtx] = useState<{ x: number; y: number; sha: string; subject: string } | null>(
    null,
  );

  const openCtx = (e: React.MouseEvent, sha: string, subject: string): void => {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, sha, subject });
  };

  /** 右键菜单项（SmartGit 的 Graph 右键操作集，按 gitDesk 现有能力适配） */
  const ctxItems: CtxItem[] = useMemo(() => {
    if (!ctx) return [];
    const { sha, subject } = ctx;
    const dis = busy !== null;
    const items: CtxItem[] = [
      { label: '查看这个提交', onClick: () => void openCommit(sha) },
      { label: '复制 SHA', onClick: () => void copyText(sha) },
      { label: '复制提交说明', onClick: () => void copyText(subject) },
      {
        label: '拣选到此分支',
        onClick: () => void cherryPickOp(sha),
        sepBefore: true,
        disabled: dis,
      },
      { label: '还原此提交…', onClick: () => void revertOp(sha), disabled: dis },
      {
        label: '软重置到此（改动留暂存区）',
        onClick: () => void resetToOp(sha, 'soft'),
        sepBefore: true,
        disabled: dis,
      },
      {
        label: '混合重置到此（改动回工作区）',
        onClick: () => void resetToOp(sha, 'mixed'),
        disabled: dis,
      },
      {
        label: '硬重置到此（丢弃提交与未提交改动）',
        onClick: () => void resetToOp(sha, 'hard'),
        danger: true,
        disabled: dis,
      },
      {
        label: '在此提交新建分支…',
        onClick: async () => {
          const name = await promptBox({
            title: `在 ${shortSha(sha)} 上新建分支`,
            label: '分支名（只创建，不切换工作区）',
            placeholder: 'feature/xxx',
            okText: '创建',
          });
          if (name) void createBranchAtOp(name.trim(), sha);
        },
        sepBefore: true,
        disabled: dis,
      },
      {
        label: '在此提交打标签…',
        onClick: async () => {
          const name = await promptBox({
            title: `在 ${shortSha(sha)} 上打标签`,
            label: '标签名',
            placeholder: 'v1.0.0',
            okText: '下一步',
          });
          if (!name) return;
          const message = await promptBox({
            title: `标签 ${name} 的说明`,
            label: '留空 = 轻量标签；填写 = 附注标签',
            okText: '创建',
          });
          void createTagOp(name.trim(), message ?? '', sha);
        },
        disabled: dis,
      },
    ];
    if (bisecting) {
      items.push({
        label: '二分：标记为好',
        onClick: () => void bisectMarkOp('good', sha),
        sepBefore: true,
        disabled: dis,
      });
      items.push({
        label: '二分：标记为坏',
        onClick: () => void bisectMarkOp('bad', sha),
        danger: true,
        disabled: dis,
      });
    } else {
      items.push({
        label: '开始二分（此提交设为坏）',
        onClick: () => void bisectStartOp(sha),
        sepBefore: true,
        disabled: dis,
      });
    }
    return items;
  }, [
    ctx,
    busy,
    openCommit,
    cherryPickOp,
    revertOp,
    resetToOp,
    bisectStartOp,
    bisectMarkOp,
    bisecting,
    createBranchAtOp,
    createTagOp,
  ]);

  const [searchMode, setSearchMode] = useState<'message' | 'path'>('message');
  const [searchText, setSearchText] = useState('');

  // 输入防抖：停下 350ms 才真正打 git
  useEffect(() => {
    const current = logQuery && logQuery.mode === searchMode ? logQuery.text : '';
    if (searchText.trim() === current) return;
    const t = setTimeout(() => setLogQuery(searchMode, searchText), 350);
    return () => clearTimeout(t);
  }, [searchText, searchMode, logQuery, setLogQuery]);

  // hover 不进 React state：一旦进 state，鼠标扫过列表会触发整列 reconcile。
  // 存 ref + 直接重绘 canvas，DOM 行的高亮交给 CSS :hover。
  const hoverRef = useRef(-1);
  const redrawRef = useRef<() => void>(() => {});
  // 满了这一页就可能还有下一页
  const hasMore = commits.length >= logLimit;
  const [viewWidth, setViewWidth] = useState(0);
  const [viewHeight, setViewHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    loadingMoreRef.current = false;
  }, [logLimit]);

  /**
   * 用 ref 回调而不是 useEffect 来测量尺寸：
   * 首帧 graph 为空时不会渲染 .commit-scroll，effect 里拿不到节点就再也不会重新测量
   * （表现为画布一直停在 canvas 默认的 300x150）。ref 回调在节点真正挂载时才会被调用。
   */
  const roRef = useRef<ResizeObserver | null>(null);
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

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

  /** 上下移动选中项（键盘用），顺手把它滚进可视区 */
  const moveSelection = useCallback(
    (delta: number) => {
      if (graph.length === 0) return;
      const cur = selectedIndex < 0 ? 0 : selectedIndex;
      const next = Math.max(0, Math.min(graph.length - 1, cur + delta));
      const sha = graph[next]?.sha;
      if (!sha) return;
      if (next !== selectedIndex) void openCommit(sha);
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        // 行是虚拟化的：目标行可能没渲染，直接算 scrollTop 把它居中
        const top = next * ROW_HEIGHT;
        const view = el.clientHeight - ROW_HEIGHT;
        const target =
          top < el.scrollTop
            ? Math.max(0, top - view / 2)
            : top > el.scrollTop + view
              ? Math.min(rowsHeight - el.clientHeight, top - view / 2)
              : el.scrollTop;
        if (target !== el.scrollTop) el.scrollTop = target;
      });
    },
    [graph, selectedIndex, openCommit, rowsHeight],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
        case 'j':
          e.preventDefault();
          moveSelection(1);
          break;
        case 'ArrowUp':
        case 'k':
          e.preventDefault();
          moveSelection(-1);
          break;
        case 'PageDown':
          e.preventDefault();
          moveSelection(20);
          break;
        case 'PageUp':
          e.preventDefault();
          moveSelection(-20);
          break;
        case 'Home':
          e.preventDefault();
          moveSelection(-graph.length);
          break;
        case 'End':
          e.preventDefault();
          moveSelection(graph.length);
          break;
        case 'Enter':
          e.preventDefault();
          openDiffModal();
          break;
        default:
          break;
      }
    },
    [moveSelection, graph.length, openDiffModal],
  );

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewWidth === 0 || viewHeight === 0) return;
    const draw = () => {
      drawGraph(canvas, graph, {
        width: viewWidth,
        graphWidth: width,
        viewportHeight: viewHeight,
        scrollTop,
        selectedIndex,
        hoverIndex: hoverRef.current,
      });
    };
    redrawRef.current = draw;
    draw();
  }, [graph, width, viewWidth, viewHeight, scrollTop, selectedIndex]);

  /** 鼠标移动 → 算出行号 → 变了才重绘 canvas（不走 React state，避免整列 reconcile） */
  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const idx = Math.floor((e.clientY - rect.top + scrollTop) / ROW_HEIGHT);
      if (idx !== hoverRef.current) {
        hoverRef.current = idx;
        redrawRef.current();
      }
    },
    [scrollTop],
  );

  const onMouseLeave = useCallback(() => {
    if (hoverRef.current !== -1) {
      hoverRef.current = -1;
      redrawRef.current();
    }
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 滚动事件可能一帧来好几次，用 rAF 合并成每帧一次重绘
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const cur = scrollRef.current;
        if (cur) setScrollTop(cur.scrollTop);
      });
    }
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

  // DOM 行虚拟化：只渲染视口内（±OVERSCAN）的行。
  // canvas 已经按视口裁剪，DOM 也要跟上——否则几千行时每次滚动都要 reconcile 全部行。
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const lastRow = Math.min(
    graph.length,
    Math.ceil((scrollTop + Math.max(viewHeight, 1)) / ROW_HEIGHT) + OVERSCAN,
  );
  const visibleRows = graph.slice(firstRow, lastRow);

  return (
    <>
      {head}
      <div className="commit-wrap">
        <canvas ref={canvasRef} className="commit-canvas" />
        <div
          className="commit-scroll"
          ref={attachScroll}
          onScroll={onScroll}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onMouseDown={() => scrollRef.current?.focus({ preventScroll: true })}
        >
          <div className="commit-inner" style={{ height: innerHeight }}>
            {visibleRows.map((row, k) => {
              const i = firstRow + k;
              const c = bySha.get(row.sha);
              if (!c) return null;
              return (
                <div
                  key={`${row.sha}-${i}`}
                  className={`commit-row${i === selectedIndex ? ' is-selected' : ''}`}
                  style={{ top: i * ROW_HEIGHT, paddingLeft: width + 6 }}
                  onClick={() => void openCommit(c.sha)}
                  onContextMenu={(e) => openCtx(e, c.sha, c.subject)}
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
                  <button
                    className="row-copy"
                    title="复制完整 SHA"
                    onClick={(e) => {
                      e.stopPropagation();
                      void copyText(c.sha);
                    }}
                  >
                    ⧉
                  </button>
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

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
    </>
  );
}
