//! Git 进程层。
//!
//! 设计约束（见 docs/PLAN.md §3）：
//! - 这里**不实现任何 Git 语义**，只负责 spawn、计时、超时、取消。
//! - 输出原样返回，解析全部交给前端 TypeScript。
//! - 一律传 argv 数组，永不拼 shell 字符串。

use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::State;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 保证输出可解析：不转义中文路径、不上色、不分页。
const GIT_BASE_ARGS: [&str; 6] = [
    "-c",
    "core.quotepath=false",
    "-c",
    "color.ui=false",
    "-c",
    "core.pager=cat",
];

/// 运行中的子进程注册表：opId -> pid，用于取消。
#[derive(Default)]
pub struct GitState(pub Mutex<HashMap<String, u32>>);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub args: Vec<String>,
    pub cwd: String,
    #[serde(default)]
    pub op_id: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub input: Option<String>,
    #[serde(default)]
    pub git_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub command: String,
    pub timed_out: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub found: bool,
    pub path: String,
    pub version: String,
    pub source: String,
}

fn quote_arg(s: &str) -> String {
    let safe = !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "_-.,:+=/@%^~[]{}".contains(c));
    if safe {
        s.to_string()
    } else {
        format!("\"{}\"", s.replace('"', "\\\""))
    }
}

fn bin_of(req: &RunRequest) -> String {
    match req.git_path.as_deref() {
        Some(p) if !p.is_empty() => p.to_string(),
        _ => "git".to_string(),
    }
}

fn format_command(req: &RunRequest) -> String {
    let mut parts: Vec<String> = Vec::with_capacity(req.args.len() + GIT_BASE_ARGS.len() + 1);
    parts.push(quote_arg(&bin_of(req)));
    for a in GIT_BASE_ARGS.iter() {
        parts.push(quote_arg(a));
    }
    for a in req.args.iter() {
        parts.push(quote_arg(a));
    }
    parts.join(" ")
}

fn base_cmd(req: &RunRequest) -> Command {
    let mut cmd = Command::new(bin_of(req));
    cmd.args(GIT_BASE_ARGS);
    cmd.args(&req.args);
    cmd.current_dir(&req.cwd);
    cmd.env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .env("LC_ALL", "C");
    cmd.stdin(if req.input.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

fn kill_pid(pid: u32) {
    #[cfg(windows)]
    {
        let mut c = Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        c.creation_flags(CREATE_NO_WINDOW);
        let _ = c.status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

fn new_op_id() -> String {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_micros())
        .unwrap_or(0);
    format!("op{}", n)
}

/// 执行一条 git 命令，完整返回 stdout/stderr。
#[tauri::command]
pub async fn git_run(state: State<'_, GitState>, req: RunRequest) -> Result<RunResult, String> {
    let started = Instant::now();
    let command = format_command(&req);
    let op_id = req.op_id.clone().unwrap_or_else(new_op_id);
    let timeout_ms = req.timeout_ms.unwrap_or(120_000).max(1_000);

    let mut child = base_cmd(&req).spawn().map_err(|e| {
        format!(
            "无法启动 git（{}）。请确认已安装 Git for Windows 并在 PATH 中。",
            e
        )
    })?;
    let pid = child.id();

    {
        let mut guard = state.0.lock().map_err(|_| "内部状态锁异常".to_string())?;
        guard.insert(op_id.clone(), pid);
    }

    if let Some(input) = req.input.clone() {
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(input.as_bytes());
            // stdin 在这里被 drop，等价于关闭 EOF
        }
    }

    // 超时看门狗：到点直接 taskkill /T，避免 git 卡在网络或钩子上
    let finished = Arc::new(AtomicBool::new(false));
    let finished_w = finished.clone();
    let _watchdog = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        while Instant::now() < deadline {
            if finished_w.load(Ordering::Relaxed) {
                return;
            }
            std::thread::sleep(Duration::from_millis(80));
        }
        kill_pid(pid);
    });

    let joined = tauri::async_runtime::spawn_blocking(move || -> (i32, String, String) {
        let mut out_pipe = child.stdout.take();
        let mut err_pipe = child.stderr.take();

        let h_out = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(p) = out_pipe.as_mut() {
                let _ = p.read_to_end(&mut buf);
            }
            buf
        });
        let h_err = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(p) = err_pipe.as_mut() {
                let _ = p.read_to_end(&mut buf);
            }
            buf
        });

        let status = child.wait();
        let out = h_out.join().unwrap_or_default();
        let err = h_err.join().unwrap_or_default();
        let code = match status {
            Ok(st) => st.code().unwrap_or(-1),
            Err(_) => -1,
        };
        (
            code,
            String::from_utf8_lossy(&out).to_string(),
            String::from_utf8_lossy(&err).to_string(),
        )
    })
    .await;

    finished.store(true, Ordering::Relaxed);

    if let Ok(mut guard) = state.0.lock() {
        guard.remove(&op_id);
    }

    let duration_ms = started.elapsed().as_millis() as u64;
    let timed_out = duration_ms >= timeout_ms;

    match joined {
        Ok((code, stdout, stderr)) => Ok(RunResult {
            code,
            stdout,
            stderr,
            duration_ms,
            command,
            timed_out,
        }),
        Err(e) => Err(format!("命令执行失败：{e}")),
    }
}

/// 取消一条正在执行的命令。
#[tauri::command]
pub fn git_cancel(state: State<'_, GitState>, op_id: String) -> bool {
    let pid = state
        .0
        .lock()
        .ok()
        .and_then(|guard| guard.get(&op_id).copied());
    match pid {
        Some(p) => {
            kill_pid(p);
            true
        }
        None => false,
    }
}

fn probe_one(bin: &str) -> Option<String> {
    let mut cmd = Command::new(bin);
    cmd.args(GIT_BASE_ARGS);
    cmd.arg("--version");
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn resolve_from_path() -> Option<String> {
    let mut cmd = Command::new("where");
    cmd.arg("git");
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .map(|l| l.to_string())
}

fn candidates() -> Vec<(String, String)> {
    let mut list: Vec<(String, String)> = vec![("git".to_string(), "PATH".to_string())];

    if let Ok(pf) = std::env::var("ProgramFiles") {
        list.push((format!("{}\\Git\\cmd\\git.exe", pf), "ProgramFiles".to_string()));
    }
    if let Ok(pf) = std::env::var("ProgramFiles(x86)") {
        list.push((
            format!("{}\\Git\\cmd\\git.exe", pf),
            "ProgramFiles(x86)".to_string(),
        ));
    }
    if let Ok(la) = std::env::var("LOCALAPPDATA") {
        list.push((
            format!("{}\\Programs\\Git\\cmd\\git.exe", la),
            "LOCALAPPDATA".to_string(),
        ));
        // 后续版本 `tauri build` 里会由前端引导下载 MinGit 到这里
        list.push((
            format!("{}\\GitDesk\\git\\cmd\\git.exe", la),
            "GitDesk MinGit".to_string(),
        ));
    }
    list
}

/// 探测可用 git。返回的 path 会由前端带上，后续命令直接用它。
#[tauri::command]
pub fn git_probe() -> ProbeResult {
    for (bin, source) in candidates() {
        if let Some(version) = probe_one(&bin) {
            let is_bare_name = bin == "git";
            let path = if is_bare_name {
                resolve_from_path().unwrap_or(bin)
            } else {
                bin
            };
            return ProbeResult {
                found: true,
                path,
                version,
                source,
            };
        }
    }
    ProbeResult {
        found: false,
        path: String::new(),
        version: String::new(),
        source: String::new(),
    }
}
