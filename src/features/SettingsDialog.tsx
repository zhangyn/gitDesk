import { useStore } from '../store';
import {
  APPEARANCE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  ROW_GAP_MAX,
  ROW_GAP_MIN,
  rowHeightOf,
} from '../ui/appearance';

/**
 * 外观设置：字号与行距。
 *
 * 改动即时生效（直接写 CSS 变量），关掉面板才算「看过效果」——
 * 所以没有「确定/取消」，只有「恢复默认」。
 */
export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const appearance = useStore((s) => s.appearance);
  const setAppearance = useStore((s) => s.setAppearance);
  const resetAppearance = useStore((s) => s.resetAppearance);

  if (!open) return null;

  const rowH = rowHeightOf(appearance);

  return (
    <div className="modal-mask" onMouseDown={() => setOpen(false)}>
      <div className="modal settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">外观设置</div>

        <div className="set-row">
          <label className="set-label" htmlFor="set-font">
            字号
          </label>
          <input
            id="set-font"
            className="set-range"
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={appearance.fontSize}
            onChange={(e) => setAppearance({ fontSize: Number(e.target.value) })}
          />
          <span className="set-value">{appearance.fontSize}px</span>
        </div>

        <div className="set-row">
          <label className="set-label" htmlFor="set-gap">
            行间距
          </label>
          <input
            id="set-gap"
            className="set-range"
            type="range"
            min={ROW_GAP_MIN}
            max={ROW_GAP_MAX}
            step={1}
            value={appearance.rowGap}
            onChange={(e) => setAppearance({ rowGap: Number(e.target.value) })}
          />
          <span className="set-value">{appearance.rowGap}px</span>
        </div>

        <div className="set-preview">
          <div className="set-preview-title">预览（行高 {rowH}px）</div>
          <div className="set-preview-rows">
            <div className="set-preview-row">
              <span className="badge ref-branch">feat/checkout</span>
              <span className="set-preview-text">feat(pay): 收银台支持分期</span>
            </div>
            <div className="set-preview-row">
              <span className="badge ref-branch">main</span>
              <span className="set-preview-text">fix: 修复切分支后历史空白</span>
            </div>
            <div className="set-preview-row">
              <span className="badge ref-remote">origin/dev</span>
              <span className="set-preview-text">chore: 升级依赖</span>
            </div>
          </div>
        </div>

        <div className="set-note">提示：Ctrl+A 只全选当前文件列表；输入框里仍是选中输入内容。</div>

        <div className="modal-actions">
          <button
            className="btn"
            onClick={() => resetAppearance()}
            disabled={
              appearance.fontSize === APPEARANCE_DEFAULT.fontSize &&
              appearance.rowGap === APPEARANCE_DEFAULT.rowGap
            }
          >
            恢复默认
          </button>
          <button className="btn" onClick={() => setOpen(false)}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
