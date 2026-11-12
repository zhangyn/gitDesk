mod git_cmd;
mod read_file;
mod watch;

use git_cmd::GitState;
use watch::WatchState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(GitState::default())
        .manage(WatchState::default())
        .invoke_handler(tauri::generate_handler![
            git_cmd::git_probe,
            git_cmd::git_run,
            git_cmd::git_cancel,
            read_file::read_text_file,
            read_file::write_text_file,
            read_file::reveal_in_explorer,
            read_file::startup_repo,
            watch::watch_repo,
            watch::unwatch_repo,
        ])
        .run(tauri::generate_context!())
        .expect("GitDesk 启动失败");
}
