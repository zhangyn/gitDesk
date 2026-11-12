import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { promptBox } from '../ui/dialog';

function Section({
  title,
  count,
  action,
  children,
  defaultOpen = true,
  dense,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  dense?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // 数据是异步来的：首次渲染时 count 还是 0，所以 defaultOpen 可能是 false。
  // 一旦它变成 true（有数据了），自动展开一次；用户手动收起后不再打扰。
  const autoOpened = useRef(false);
  useEffect(() => {
    if (defaultOpen && !autoOpened.current) {
      autoOpened.current = true;
      setOpen(true);
    }
  }, [defaultOpen]);

  return (
    <div className={`section${dense ? ' dense' : ''}`}>
      <div className="section-bar">
        <button className="section-head" onClick={() => setOpen((v) => !v)}>
          <span className={`chev${open ? ' open' : ''}`}>▸</span>
          <span>{title}</span>
          {typeof count === 'number' && <span className="count">{count}</span>}
        </button>
        {action && <span className="section-action">{action}</span>}
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

/** origin/feature-x → feature-x */
function remoteToLocal(name: string): string {
  const i = name.indexOf('/');
  return i >= 0 ? name.slice(i + 1) : name;
}

/** 相对上游的领先/落后标记：>1 表示本地多 1 个提交，<2 表示本地少 2 个 */
function TrackBadge({ ahead, behind, gone }: { ahead: number; behind: number; gone: boolean }) {
  if (gone) return <span className="tr tr-gone">上游已删</span>;
  if (ahead === 0 && behind === 0) return null;
  return (
    <span className="tr">
      {ahead > 0 && <span className="tr-ahead">&gt;{ahead}</span>}
      {behind > 0 && <span className="tr-behind">&lt;{behind}</span>}
    </span>
  );
}

export function RefsPanel() {
  const status = useStore((s) => s.status);
  const refs = useStore((s) => s.refs);
  const stashes = useStore((s) => s.stashes);
  const backups = useStore((s) => s.backups);
  const switchBranchOp = useStore((s) => s.switchBranchOp);
  const deleteBranchOp = useStore((s) => s.deleteBranchOp);
  const createBranchOp = useStore((s) => s.createBranchOp);
  const createTrackingBranchOp = useStore((s) => s.createTrackingBranchOp);
  const openStash = useStore((s) => s.openStash);
  const openCompare = useStore((s) => s.openCompare);
  const createTagOp = useStore((s) => s.createTagOp);
  const deleteTagOp = useStore((s) => s.deleteTagOp);
  const stashApplyOp = useStore((s) => s.stashApplyOp);
  const stashDropOp = useStore((s) => s.stashDropOp);
  const stashSaveOp = useStore((s) => s.stashSaveOp);
  const restoreBackupOp = useStore((s) => s.restoreBackupOp);

  const branches = refs.filter((r) => r.kind === 'branch');
  const remotes = refs.filter((r) => r.kind === 'remote');
  const tags = refs.filter((r) => r.kind === 'tag');
  const head = status?.branch.head ?? null;

  const newBranch = async () => {
    const name = await promptBox({
      title: '新建分支',
      label: '分支名（会立即切换过去）',
      placeholder: 'feature/xxx',
      okText: '创建',
    });
    if (name) await createBranchOp(name.trim());
  };

  const newTag = async () => {
    const name = await promptBox({
      title: '新建标签',
      label: '标签名（打在当前 HEAD 上）',
      placeholder: 'v1.0.0',
      okText: '下一步',
    });
    if (!name) return;
    const message = await promptBox({
      title: `标签 ${name} 的说明`,
      label: '留空 = 轻量标签；填写 = 附注标签',
      okText: '创建',
    });
    await createTagOp(name.trim(), message ?? '');
  };

  const newStash = async () => {
    const message = await promptBox({
      title: '保存 stash',
      label: '说明（可选，包含未跟踪文件）',
      okText: '保存',
    });
    await stashSaveOp(message ?? '');
  };

  return (
    <div className="refs-inner">
      <Section
        title="本地分支"
        count={branches.length}
        action={
          <button className="icon-btn" title="新建分支" onClick={() => void newBranch()}>
            +
          </button>
        }
      >
        {branches.map((b) => {
          const current = b.name === head;
          return (
            <div
              key={b.name}
              className={`ref-row${current ? ' is-current' : ''}`}
              title={`${b.name}${b.upstream ? `\n上游：${b.upstream}` : '\n没有上游分支'}\n双击切换到该分支`}
            >
              <button className="ref-main" onDoubleClick={() => void switchBranchOp(b.name)}>
                <span className="dot dot-branch" />
                <span className="ref-name">{b.name}</span>
                <TrackBadge ahead={b.ahead} behind={b.behind} gone={b.gone} />
                {current && <span className="ref-cur">HEAD</span>}
              </button>
              {!current && (
                <span className="row-actions">
                  <button
                    className="icon-btn"
                    title="与当前分支对比"
                    onClick={() => void openCompare(head ?? 'HEAD', b.name)}
                  >
                    ⧉
                  </button>
                  <button
                    className="icon-btn danger"
                    title="删除分支"
                    onClick={() => void deleteBranchOp(b.name)}
                  >
                    ✕
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </Section>

      <Section title="远程分支" count={remotes.length} defaultOpen={false}>
        {remotes.length === 0 && <div className="empty-hint small">无</div>}
        {remotes.map((r) => (
          <div
            key={r.name}
            className="ref-row remote-row"
            title={`${r.name}\n双击检出为本地分支`}
            onDoubleClick={async () => {
              const local = await promptBox({
                title: `检出 ${r.name}`,
                label: '本地分支名（不存在就创建并跟踪该远程分支）',
                initial: remoteToLocal(r.name),
                okText: '检出',
              });
              if (local) await createTrackingBranchOp(local.trim(), r.name);
            }}
          >
            <span className="dot dot-remote" />
            <span className="ref-name">{r.name}</span>
            <span className="row-actions">
              <button
                className="icon-btn"
                title="检出为本地分支"
                onClick={async () => {
                  const local = await promptBox({
                    title: `检出 ${r.name}`,
                    label: '本地分支名（不存在就创建并跟踪该远程分支）',
                    initial: remoteToLocal(r.name),
                    okText: '检出',
                  });
                  if (local) await createTrackingBranchOp(local.trim(), r.name);
                }}
              >
                ⤓
              </button>
            </span>
          </div>
        ))}
      </Section>

      <Section
        title="标签"
        count={tags.length}
        defaultOpen={false}
        action={
          <button className="icon-btn" title="新建标签" onClick={() => void newTag()}>
            +
          </button>
        }
      >
        {tags.length === 0 && <div className="empty-hint small">无</div>}
        {tags.map((t) => (
          <div key={t.name} className="ref-row" title={t.sha}>
            <span className="dot dot-tag" />
            <span className="ref-name">{t.name}</span>
            <span className="row-actions">
              <button
                className="icon-btn danger"
                title="删除标签"
                onClick={() => void deleteTagOp(t.name)}
              >
                ✕
              </button>
            </span>
          </div>
        ))}
      </Section>

      <Section
        title="Stash"
        count={stashes.length}
        defaultOpen={false}
        action={
          <button className="icon-btn" title="保存 stash" onClick={() => void newStash()}>
            +
          </button>
        }
      >
        {stashes.length === 0 && <div className="empty-hint small">无</div>}
        {stashes.map((s) => (
          <div
            key={s.ref}
            className="ref-row stash-row-item"
            title={`${s.ref}\n${s.subject}\n单击查看内容 · 双击 Pop`}
          >
            <button
              className="ref-main"
              onClick={() => void openStash(s.ref)}
              onDoubleClick={() => void stashApplyOp(s.ref, true)}
            >
              <span className="dot dot-stash" />
              <span className="ref-name">{s.subject || s.ref}</span>
              <span className="stash-ref mono">{s.ref}</span>
            </button>
            <span className="row-actions">
              <button
                className="icon-btn"
                title="Pop（应用并删除）"
                onClick={() => void stashApplyOp(s.ref, true)}
              >
                ⤓
              </button>
              <button
                className="icon-btn"
                title="应用但保留 stash"
                onClick={() => void stashApplyOp(s.ref, false)}
              >
                ↩
              </button>
              <button
                className="icon-btn danger"
                title="删除 stash"
                onClick={() => void stashDropOp(s.ref)}
              >
                ✕
              </button>
            </span>
          </div>
        ))}
      </Section>

      <Section title="备份" count={backups.length} defaultOpen={false}>
        {backups.length === 0 && (
          <div className="empty-hint small">丢弃/恢复类操作前会自动快照</div>
        )}
        {backups.map((b) => (
          <div key={b.ref} className="ref-row" title={`${b.ref}\n${b.sha}`}>
            <span className="dot dot-backup" />
            <span className="ref-name mono">{b.ref.replace('refs/gitdesk/backups/', '')}</span>
            <span className="row-actions">
              <button
                className="icon-btn"
                title="恢复这份备份"
                onClick={() => void restoreBackupOp(b.sha)}
              >
                ↩
              </button>
            </span>
          </div>
        ))}
      </Section>
    </div>
  );
}
