import { formatCommand, useLog } from '../stores/log';
import { useStore } from '../store';

function timeFmt(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function CommandLog() {
  const entries = useLog((s) => s.entries);
  const clear = useLog((s) => s.clear);
  const setBottomPanel = useStore((s) => s.setBottomPanel);

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
  };

  const newestFirst = [...entries].reverse();

  return (
    <div className="bottom-panel log-panel">
      <div className="bp-head">
        <span className="bp-title">命令日志</span>
        <span className="bp-sub">每条等价的 git 命令、退出码和耗时 —— 可以直接复制到终端重跑</span>
        <span className="spacer" />
        <button className="btn small" onClick={clear} disabled={entries.length === 0}>
          清空
        </button>
        <button className="icon-btn" title="关闭" onClick={() => setBottomPanel('log')}>
          ✕
        </button>
      </div>
      <div className="log-body">
        {newestFirst.length === 0 && <div className="empty-hint small">还没有执行过命令</div>}
        {newestFirst.map((e) => {
          const cmd = formatCommand(e.argv);
          return (
            <div className={`log-row${e.code === 0 ? '' : ' is-fail'}`} key={e.id}>
              <span className="t">{timeFmt(e.at)}</span>
              <span className={`code${e.code === 0 ? ' ok' : ' bad'}`}>[{e.code}]</span>
              <span className="ms">{e.durationMs}ms</span>
              <span className="cmd mono" title={cmd}>
                {cmd}
              </span>
              <button className="link" onClick={() => copy(cmd)}>
                复制
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
