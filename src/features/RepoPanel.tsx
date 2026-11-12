import { useState } from 'react';
import { useStore } from '../store';
import { IconFolder } from '../ui/icons';

/**
 * 左栏顶部的仓库列表（对标 SmartGit 的 Repositories 面板）。
 * 每个仓库显示 `name (branch)`，点一下即切换 —— 多项目不用每次走「打开仓库」。
 */
export function RepoPanel() {
  const repo = useStore((s) => s.repo);
  const recent = useStore((s) => s.recent);
  const openPath = useStore((s) => s.openPath);
  const pickRepo = useStore((s) => s.pickRepo);
  const removeRecent = useStore((s) => s.removeRecent);
  const closeRepo = useStore((s) => s.closeRepo);
  const busy = useStore((s) => s.busy);

  const [open, setOpen] = useState(true);
  return (
    <div className="repo-panel">
      <div className="section-bar">
        <button className="section-head" onClick={() => setOpen((v) => !v)}>
          <span className={`chev${open ? ' open' : ''}`}>▸</span>
          <span>仓库</span>
          <span className="count">{recent.length}</span>
        </button>
        <span className="section-action">
          <button className="icon-btn" title="打开其他仓库" onClick={() => void pickRepo()}>
            +
          </button>
        </span>
      </div>

      {open && (
        <div className="repo-list">
          {recent.length === 0 && <div className="empty-hint small">还没有打开过仓库</div>}
          {recent.map((r) => {
            const active = r.path === repo?.path;
            return (
              <div
                key={r.path}
                className={`repo-item${active ? ' is-current' : ''}`}
                title={r.path}
              >
                <button
                  className="repo-item-main"
                  disabled={busy !== null}
                  onClick={() => void openPath(r.path)}
                >
                  <IconFolder size={13} className="repo-item-icon" />
                  <span className="repo-item-name">{r.name}</span>
                </button>
                <span className="row-actions">
                  <button
                    className="icon-btn danger"
                    title="从列表移除"
                    onClick={() => removeRecent(r.path)}
                  >
                    ✕
                  </button>
                </span>
              </div>
            );
          })}
          {repo && (
            <button className="repo-close" onClick={closeRepo}>
              关闭当前仓库
            </button>
          )}
        </div>
      )}
    </div>
  );
}
