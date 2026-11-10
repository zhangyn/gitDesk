import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { Toolbar } from './features/Toolbar';
import { SidePanel } from './features/SidePanel';
import { ProjectList } from './features/ProjectList';
import { CenterStack } from './features/CenterStack';
import { CommitPanel } from './features/CommitPanel';
import { CommandLog } from './features/CommandLog';
import { DiffModal } from './features/DiffModal';
import { ModalHost } from './ui/Modal';
import { StatusBar } from './features/StatusBar';

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
        setTheme(theme === 'light' ? 'dark' : 'light');
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

          {bottomPanel === 'commit' && <CommitPanel />}
          {bottomPanel === 'log' && <CommandLog />}
        </>
      ) : (
        <ProjectList />
      )}

      <StatusBar />

      <DiffModal />
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
