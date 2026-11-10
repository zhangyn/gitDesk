import { useStore } from '../store';
import { Logo } from '../ui/icons';

function fmtDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ProjectList() {
  const recent = useStore((s) => s.recent);
  const pickRepo = useStore((s) => s.pickRepo);
  const openPath = useStore((s) => s.openPath);
  const removeRecent = useStore((s) => s.removeRecent);
  const error = useStore((s) => s.error);
  const busy = useStore((s) => s.busy);

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-brand">
          <Logo size={46} />
          <div>
            <h1>GitDesk</h1>
            <p>轻量 Git 客户端 · 不背 Chromium，不重写 Git</p>
          </div>
        </div>

        <button className="btn primary big-btn" onClick={() => void pickRepo()} disabled={busy !== null}>
          + 打开仓库
        </button>

        <div className="welcome-list-head">
          <span>最近打开</span>
          <span className="count">{recent.length}</span>
        </div>

        <div className="welcome-list">
          {recent.length === 0 && (
            <div className="empty-hint">
              还没有打开过仓库。点上面的按钮选一个本地 Git 仓库目录，之后会出现在这里。
            </div>
          )}
          {recent.map((r) => (
            <div key={r.path} className="repo-card">
              <button className="repo-card-main" onClick={() => void openPath(r.path)} title={r.path}>
                <span className="repo-card-name">{r.name}</span>
                <span className="repo-card-path mono">{r.path}</span>
              </button>
              <span className="repo-card-date">{fmtDate(r.openedAt)}</span>
              <button
                className="icon-btn danger"
                title="从列表移除"
                onClick={() => removeRecent(r.path)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {error && <div className="welcome-error">{error}</div>}
      </div>
    </div>
  );
}
