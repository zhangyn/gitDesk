import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { Toolbar } from './features/Toolbar';
import { SidePanel } from './features/SidePanel';
import { ProjectList } from './features/ProjectList';
import { CenterStack } from './features/CenterStack';
import { CommitDialog } from './features/CommitDialog';
import { CommandLog } from './features/CommandLog';
import { DiffModal } from './features/DiffModal';
import { CredentialDialog } from './features/CredentialDialog';
import { ModalHost } from './ui/Modal';
import { StatusBar } from './features/StatusBar';
import { flipTheme } from './ui/theme';

const LEFT_KEY = 'gitdesk.leftWidth';
const LEFT_MIN = 190;
const LEFT_MAX = 620;
/** 默认左栏宽度：分支名普遍较长，窄了会被截断 */
const LEFT_DEFAULT = 300;
const SPLIT_W = 5;

function loadLeftWidth(): number {
  const n = Number(localStorage.getItem(LEFT_KEY));
  return Number.isFinite(n) && n >= LEFT_MIN && n <= LEFT_MAX ? n : LEFT_DEFAULT;
}

export default function App() {
  const boot = useStore((s) => s.boot);
  const repo = useStore((s) => s.repo);
  const error = useStore((s) => s.error);
  const clearError = useStore((s) => s.clearError);
  const busy = useStore((s) => s.busy);
  const bottomPanel = useStore((s) => s.bottomPanel);
  const setBottomPanel = useStore((s) => s.setBottomPanel);
  const refresh = useStore((s) => s.refresh);
  const pickRepo = useStore((s) => s.pickRepo);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const ongoing = useStore((s) => s.ongoing);
  const status = useStore((s) => s.status);
  const continueOp = useStore((s) => s.continueOp);
  const skipOp = useStore((s) => s.skipOp);
  const abortOp = useStore((s) => s.abortOp);
  const bisecting = useStore((s) => s.bisecting);
  const bisectInfo = useStore((s) => s.bisectInfo);
  const bisectMarkOp = useStore((s) => s.bisectMarkOp);
  const bisectResetOp = useStore((s) => s.bisectResetOp);

  const [leftW, setLeftW] = useState(loadLeftWidth);
  const hostRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    void boot();
  }, [boot]);

  // 左栏宽度持久化
  useEffect(() => {
    try {
      localStorage.setItem(LEFT_KEY, String(Math.round(leftW)));
    } catch {
      /* 忽略 */
    }
  }, [leftW]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'F5' || (mod && e.key.toLowerCase() === 'r')) {
        e.preventDefault();
        void refresh();
      } else if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void pickRepo();
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setBottomPanel('commit');
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setTheme(flipTheme(theme));
      } else if (e.key === 'Escape' && bottomPanel !== 'none') {
        setBottomPanel(bottomPanel);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refresh, pickRepo, setBottomPanel, bottomPanel, theme, setTheme]);

  const startDragLeft = (e: React.MouseEvent) => {
    e.preventDefault();
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const startX = e.clientX;
    const startW = leftW;
    let latest = startW;

    const onMove = (ev: MouseEvent) => {
      const next = Math.max(
        LEFT_MIN,
        Math.min(LEFT_MAX, Math.min(rect.width * 0.6, startW + (ev.clientX - startX))),
      );
      latest = next;
      setLeftW(next);
    };
    const stop = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('blur', stop);
      document.body.classList.remove('is-resizing-x');
      setLeftW(latest);
    };

    document.body.classList.add('is-resizing-x');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stop);
    window.addEventListener('blur', stop);
  };

  return (
    <div className="app">
      <Toolbar />

      {repo ? (
        <>
          {ongoing && (
            <div className="ongoing-banner">
              <span className="ob-title">进行中：{ongoing}</span>
              <span className="ob-sub">
                {(status?.entries ?? []).filter((e) => e.kind === 'unmerged').length > 0
                  ? `还有 ${
                      (status?.entries ?? []).filter((e) => e.kind === 'unmerged').length
                    } 个冲突文件待解决`
                  : '所有冲突已解决，可以继续'}
              </span>
              <span className="spacer" />
              <button className="btn small primary" onClick={() => void continueOp()}>
                继续
              </button>
              {ongoing === 'rebase' && (
                <button className="btn small" onClick={() => void skipOp()}>
                  跳过此提交
                </button>
              )}
              <button className="btn small danger" onClick={() => void abortOp()}>
                中止
              </button>
            </div>
          )}

          {bisecting && (
            <div className="ongoing-banner bisect-banner">
              <span className="ob-title">进行中：二分查找（bisect）</span>
              <span className="ob-sub" title={bisectInfo ?? undefined}>
                {bisectInfo
                  ? bisectInfo
                  : '先在提交详情里点「好标记」确定范围，然后测试当前检出的代码并标记'}
              </span>
              <span className="spacer" />
              <button
                className="btn small primary"
                disabled={busy !== null}
                title="git bisect good：当前检出的提交表现正常"
                onClick={() => void bisectMarkOp('good')}
              >
                当前是好的
              </button>
              <button
                className="btn small danger"
                disabled={busy !== null}
                title="git bisect bad：当前检出的提交有问题"
                onClick={() => void bisectMarkOp('bad')}
              >
                当前是坏的
              </button>
              <button
                className="btn small"
                disabled={busy !== null}
                title="git bisect skip：这个提交测不了，跳过它"
                onClick={() => void bisectMarkOp('skip')}
              >
                跳过
              </button>
              <button
                className="btn small"
                disabled={busy !== null}
                title="git bisect reset：结束二分并回到原分支"
                onClick={() => void bisectResetOp()}
              >
                结束
              </button>
            </div>
          )}

          <main
            className="workspace"
            ref={hostRef}
            style={{ gridTemplateColumns: `${leftW}px ${SPLIT_W}px minmax(0, 1fr)` }}
          >
            <SidePanel />
            <div
              className="vsplitter"
              onMouseDown={startDragLeft}
              onDoubleClick={() => setLeftW(LEFT_DEFAULT)}
              title="拖动调整左栏宽度 · 双击恢复默认"
            />
            <CenterStack />
          </main>

          {bottomPanel === 'commit' && <CommitDialog />}
          {bottomPanel === 'log' && <CommandLog />}
        </>
      ) : (
        <ProjectList />
      )}

      <StatusBar />

      <DiffModal />
      <CredentialDialog />
      <ModalHost />

      {error && (
        <div className="error-bar">
          <span className="error-text">{error}</span>
          <button className="btn small" onClick={clearError}>
            关闭
          </button>
        </div>
      )}

      {busy && <div className="busy-pill">{busy}</div>}
    </div>
  );
}
