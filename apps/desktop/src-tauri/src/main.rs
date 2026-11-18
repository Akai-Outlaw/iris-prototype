#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod backend;
mod speech;
mod wake;
use tauri::Manager;
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|arg| arg == "--voice-check") {
        let Some(path) = args.get(2) else {
            eprintln!("Supply a WAV output path");
            std::process::exit(2)
        };
        let result = tokio::runtime::Runtime::new()
            .expect("Cannot start the diagnostic runtime")
            .block_on(backend::voice_diagnostic(std::path::PathBuf::from(path)));
        match result {
            Ok(value) => println!("{value}"),
            Err(error) => {
                eprintln!("{}", serde_json::json!({"error":error}));
                std::process::exit(1)
            }
        }
        return;
    }

    tauri::Builder::default()
        .setup(|app| {
            let state = backend::Backend::new(app.handle()).map_err(std::io::Error::other)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            wake::wake_start,
            wake::wake_control,
            backend::save_secret,
            backend::remove_secret,
            backend::provider_status,
            backend::list_voices,
            backend::load_workspace,
            backend::save_workspace,
            backend::clear_history,
            backend::runtime_connect,
            backend::runtime_command,
            backend::runtime_disconnect,
            backend::choose_root,
            backend::reveal_artifact,
            backend::open_source,
            backend::stt_start,
            backend::stt_write,
            backend::stt_stop,
            backend::stt_cancel,
            backend::tts_speak,
            backend::tts_cancel
        ])
        .build(tauri::generate_context!())
        .expect("Iris desktop failed to launch")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                wake::stop();
                app.state::<backend::Backend>().stop();
            }
        });
}
