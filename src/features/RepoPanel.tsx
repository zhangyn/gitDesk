import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { IconFolder } from '../ui/icons';

const FAV_KEY = 'gitdesk.favorites';

function loadFavorites(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function saveFavorites(list: string[]): void {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(list));
  } catch {
    /* 忽略配额错误 */
  }
}

/**
 * 左栏顶部的仓库列表（对标 SmartGit 的 Repositories 面板）。
 * 每个仓库显示 `name (branch)`，点一下即切换 —— 多项目不用每次走「打开仓库」。
 * 收藏的仓库置顶显示（☆/★ 切换，按路径持久化）。
 */
export function RepoPanel() {
  const repo = useStore((s) => s.repo);
  const recent = useStore((s) => s.recent);
  const repoBranches = useStore((s) => s.repoBranches);
  const openPath = useStore((s) => s.openPath);
  const pickRepo = useStore((s) => s.pickRepo);
  const removeRecent = useStore((s) => s.removeRecent);
  const closeRepo = useStore((s) => s.closeRepo);
  const busy = useStore((s) => s.busy);

  const [open, setOpen] = useState(true);
  const [favs, setFavs] = useState<string[]>(loadFavorites);

  const toggleFav = (path: string) => {
    const next = favs.includes(path) ? favs.filter((p) => p !== path) : [...favs, path];
    setFavs(next);
    saveFavorites(next);
  };

  // 收藏置顶，其余按最近打开顺序（sort 稳定，组内顺序不变）
  const sorted = useMemo(
    () =>
      [...recent].sort((a, b) => (favs.includes(b.path) ? 1 : 0) - (favs.includes(a.path) ? 1 : 0)),
    [recent, favs],
  );

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
          {sorted.map((r) => {
            const active = r.path === repo?.path;
            const fav = favs.includes(r.path);
            return (
              <div
                key={r.path}
                className={`repo-item${active ? ' is-current' : ''}${fav ? ' is-fav' : ''}`}
                title={r.path}
              >
                <button
                  className="repo-item-main"
                  disabled={busy !== null}
                  onClick={() => void openPath(r.path)}
                >
                  <IconFolder size={13} className="repo-item-icon" />
                  <span className="repo-item-name">{r.name}</span>
                  {/* SmartGit 式的 name (branch)：一眼看出每个仓库停在哪条分支 */}
                  {repoBranches[r.path] && (
                    <span className="repo-item-branch">({repoBranches[r.path]})</span>
                  )}
                </button>
                <span className="row-actions">
                  <button
                    className="icon-btn"
                    title={fav ? '取消收藏' : '收藏（置顶显示）'}
                    onClick={() => toggleFav(r.path)}
                  >
                    {fav ? '★' : '☆'}
                  </button>
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
