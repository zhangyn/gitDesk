import { useStore } from '../store';
import { RepoPanel } from './RepoPanel';
import { RefsPanel } from './RefsPanel';

/**
 * 左栏：上面仓库列表，下面分支/标签/Stash（超出高度时内部滚动）。
 * 不再分 Tab —— 分支是高频操作，藏进 Tab 反而多一次点击。
 */
export function SidePanel() {
  const repo = useStore((s) => s.repo);

  return (
    <aside className="side-panel">
      <RepoPanel />
      <div className="side-scroll">
        {repo ? <RefsPanel /> : <div className="empty-hint small">打开一个仓库后显示分支</div>}
      </div>
    </aside>
  );
}
