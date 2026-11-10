//! 工作区文件监听：任何磁盘变化都通知前端刷新。
//!
//! 只做「有东西变了」的粗粒度通知，具体刷新策略交给前端（它知道当前在哪个页签）。
//! 这一点很重要：`git status` 自己会写 `.git/index`，如果前端不节流就会自激循环。

use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// 合并事件的时间窗：这段时间内的所有变化只发一次通知
const DEBOUNCE: Duration = Duration::from_millis(350);

#[derive(Default)]
pub struct WatchState(pub Mutex<Option<RecommendedWatcher>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangedEvent {
    /// "git"（.git 内部变了：切分支、合并、提交）或 "worktree"
    scope: &'static str,
}

fn normalize(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

/// 这些目录的抖动对 UI 没有意义，且量极大。
/// 注意：必须相对**监听根目录**判断——否则仓库本身位于 `.../.tmp/...` 这类路径时，
/// 所有事件都会被误杀（第一版就踩了这个坑，表现为"监听成功但永远收不到事件"）。
fn ignored(p_lower: &str, root_lower: &str) -> bool {
    let rel = p_lower.strip_prefix(root_lower).unwrap_or(p_lower);
    rel.contains("/node_modules/")
        || rel.contains("/target/")
        || rel.contains("/dist/")
        || rel.contains("/.git/objects/")
        || rel.contains("/.git/lfs/")
}

fn scope_of(p_lower: &str) -> &'static str {
    if p_lower.contains("/.git/") || p_lower.ends_with("/.git") {
        "git"
    } else {
        "worktree"
    }
}

fn absorb(
    scope: &mut Option<&'static str>,
    res: notify::Result<notify::Event>,
    root_lower: &str,
) {
    let Ok(ev) = res else { return };
    for path in ev.paths {
        let s = normalize(&path);
        let lower = s.to_lowercase();
        if ignored(&lower, root_lower) {
            continue;
        }
        let sc = scope_of(&lower);
        *scope = Some(match (*scope, sc) {
            (Some("git"), _) | (_, "git") => "git",
            _ => "worktree",
        });
    }
}

/// 开始监听某个仓库（换仓库时自动停掉旧的）
#[tauri::command]
pub fn watch_repo(app: AppHandle, state: State<'_, WatchState>, path: String) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "watch 状态异常".to_string())?;
    *guard = None; // 丢掉旧的 watcher → 它内部的 sender 也一起 drop，旧线程自然退出

    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })
    .map_err(|e| format!("无法创建文件监听：{e}"))?;

    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| format!("无法监听 {path}：{e}"))?;

    *guard = Some(watcher);
    drop(guard);

    // 事件里的路径是绝对路径，和传进来的 path 分隔符/大小写可能不一致
    let root_lower = normalize(Path::new(&path)).to_lowercase();

    std::thread::spawn(move || loop {
        let first = match rx.recv() {
            Ok(v) => v,
            Err(_) => return, // watcher 被 drop
        };

        let mut scope: Option<&'static str> = None;
        absorb(&mut scope, first, &root_lower);

        // 时间窗内继续吸收，直到安静下来才发一次
        let deadline = Instant::now() + DEBOUNCE;
        loop {
            let left = match deadline.checked_duration_since(Instant::now()) {
                Some(d) if !d.is_zero() => d,
                _ => break,
            };
            match rx.recv_timeout(left) {
                Ok(res) => absorb(&mut scope, res, &root_lower),
                Err(_) => break,
            }
        }

        if let Some(scope) = scope {
            let _ = app.emit("repo://changed", ChangedEvent { scope });
        }
    });

    Ok(())
}

/// 停止监听（关闭仓库、切仓库前调用）
#[tauri::command]
pub fn unwatch_repo(state: State<'_, WatchState>) {
    if let Ok(mut guard) = state.0.lock() {
        *guard = None;
    }
}
