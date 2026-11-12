//! 只读文件读取，用于展示「未跟踪文件」的内容（git diff 看不到它们）。

use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadRequest {
    pub path: String,
    #[serde(default)]
    pub max_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub text: String,
    pub binary: bool,
    pub truncated: bool,
    pub size: u64,
}

#[tauri::command]
pub fn read_text_file(req: ReadRequest) -> Result<ReadResult, String> {
    let path = PathBuf::from(&req.path);
    let meta = std::fs::metadata(&path).map_err(|e| format!("无法读取 {}：{}", req.path, e))?;
    if !meta.is_file() {
        return Err(format!("不是普通文件：{}", req.path));
    }

    let limit = req.max_bytes.unwrap_or(2 * 1024 * 1024).min(16 * 1024 * 1024);
    let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut buf: Vec<u8> = Vec::new();
    file.by_ref()
        .take(limit)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;

    let truncated = meta.len() > buf.len() as u64;
    let binary = buf.iter().any(|b| *b == 0);

    Ok(ReadResult {
        text: String::from_utf8_lossy(&buf).to_string(),
        binary,
        truncated,
        size: meta.len(),
    })
}

/* ------------------------------------------------------------------ 写入 */

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteRequest {
    pub path: String,
    pub content: String,
}

/// 覆盖写入一个文本文件（冲突解决用）。
/// 只允许写已存在的文件，避免因为路径拼错而凭空造文件。
#[tauri::command]
pub fn write_text_file(req: WriteRequest) -> Result<u64, String> {
    let path = PathBuf::from(&req.path);
    let meta = std::fs::metadata(&path).map_err(|e| format!("无法访问 {}：{}", req.path, e))?;
    if !meta.is_file() {
        return Err(format!("不是普通文件：{}", req.path));
    }
    std::fs::write(&path, req.content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(req.content.len() as u64)
}

/* ------------------------------------------------- 外部打开 */

/// 在资源管理器中显示文件/目录。
/// 文件用 `/select,` 定位并选中；目录直接打开。explorer 自己异步启动，不等待退出。
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("路径不存在：{}", path));
    }
    #[cfg(windows)]
    {
        let mut cmd = Command::new("explorer.exe");
        if p.is_file() {
            cmd.arg(format!("/select,{}", path));
        } else {
            cmd.arg(&path);
        }
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.spawn().map_err(|e| format!("无法打开资源管理器：{}", e))?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        Err("仅支持 Windows".to_string())
    }
}

/* ------------------------------------------------------------ 启动参数 */
/// 支持 `gitdesk.exe D:\path\to\repo`（右键「用 GitDesk 打开」/ 命令行）。
/// 只接受存在且带 .git 的目录，避免误判。
#[tauri::command]
pub fn startup_repo() -> Option<String> {
    for arg in std::env::args().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let p = PathBuf::from(&arg);
        if !p.is_dir() {
            continue;
        }
        if p.join(".git").exists() {
            return Some(p.to_string_lossy().to_string());
        }
        // 传的是仓库内子目录时，向上找 .git（最多 6 层）
        let mut cur = p.as_path();
        for _ in 0..6 {
            match cur.parent() {
                Some(parent) => {
                    if parent.join(".git").exists() {
                        return Some(cur.to_string_lossy().to_string());
                    }
                    cur = parent;
                }
                None => break,
            }
        }
    }
    None
}
