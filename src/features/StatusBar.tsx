import { useStore } from '../store';
import { useLog } from '../stores/log';
import { IconLog } from '../ui/icons';

/** 底部状态条（对标 SmartGit 的 Ready / 1 File / 1:1 那一行） */
export function StatusBar() {
  const repo = useStore((s) => s.repo);
  const status = useStore((s) => s.status);
  const git = useStore((s) => s.git);
  const busy = useStore((s) => s.busy);
  const bottomPanel = useStore((s) => s.bottomPanel);
  const setBottomPanel = useStore((s) => s.setBottomPanel);
  const logEntries = useLog((s) => s.entries);
  const last = logEntries[logEntries.length - 1];

  const entries = status?.entries ?? [];
  const staged = entries.filter((e) => e.kind !== 'untracked' && e.index !== '.').length;
  const conflicted = entries.filter((e) => e.kind === 'unmerged').length;

  return (
    <footer className="statusbar">
      <span className={`sb-state${busy ? ' is-busy' : ''}`}>{busy ?? '就绪'}</span>

      {repo && (
        <>
          <span className="sb-sep" />
          <span className="sb-path" title={repo.path}>
            {repo.path}
          </span>
          <span className="sb-sep" />
          <span className="sb-item">{entries.length} 个变更</span>
          {staged > 0 && <span className="sb-item dim">已暂存 {staged}</span>}
          {conflicted > 0 && <span className="sb-item danger">冲突 {conflicted}</span>}
        </>
      )}

      <span className="spacer" />

      {last && !busy && (
        <span
          className={`sb-item dim mono${last.code === 0 ? '' : ' danger'}`}
          title={last.argv.join(' ')}
        >
          上次 {last.durationMs}ms
        </span>
      )}
      {git?.found && (
        <span className="sb-item dim mono" title={git.path}>
          {git.version.replace(/^git version\s*/i, 'git ')}
        </span>
      )}
      <button
        className={`sb-btn${bottomPanel === 'log' ? ' is-on' : ''}`}
        onClick={() => setBottomPanel('log')}
        title="命令日志"
      >
        <IconLog size={12} /> 日志
      </button>
    </footer>
  );
}
