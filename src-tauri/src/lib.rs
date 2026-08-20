use serde_json::Value;
use std::{
    env,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::Mutex,
    thread,
};
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;
const CREATOR_URL: &str = "https://www.threads.com/@r2voltz?hl=ko";

struct BackendProcess {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
struct BackendState(Mutex<Option<BackendProcess>>);

fn bundled_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let python = resource_dir.join("python").join("python.exe");
    let bootstrap = resource_dir.join("backend").join("bootstrap.py");
    let ffmpeg = resource_dir.join("ffmpeg").join("ffmpeg.exe");
    Ok((python, bootstrap, ffmpeg))
}

fn resolve_python(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    if let Ok(custom_python) = env::var("SPLTR_DEV_PYTHON") {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        return Ok((
            PathBuf::from(custom_python),
            manifest.join("..").join("python").join("bootstrap.py"),
            PathBuf::from(env::var("SPLTR_FFMPEG").unwrap_or_else(|_| "ffmpeg".to_string())),
        ));
    }
    bundled_paths(app)
}

fn emit_backend_line(app: &AppHandle, line: &str) {
    match serde_json::from_str::<Value>(line) {
        Ok(payload) => {
            let _ = app.emit("backend-event", payload);
        }
        Err(_) if !line.trim().is_empty() => {
            eprintln!("backend: {line}");
        }
        _ => {}
    }
}

#[tauri::command]
fn backend_start(app: AppHandle, state: State<'_, BackendState>) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Backend lock is poisoned".to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    let (python, bootstrap, ffmpeg) = resolve_python(&app)?;
    if !python.exists() && python != Path::new("python") {
        return Err(format!(
            "Bundled Python was not found at {}. Run npm run prepare:windows.",
            python.display()
        ));
    }
    if !bootstrap.exists() {
        return Err(format!(
            "Backend bootstrap was not found at {}.",
            bootstrap.display()
        ));
    }

    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data)
        .map_err(|e| format!("Cannot create app data folder: {e}"))?;

    let mut command = Command::new(&python);
    command
        .arg("-u")
        .arg(&bootstrap)
        .arg("--app-data")
        .arg(&app_data)
        .arg("--ffmpeg")
        .arg(&ffmpeg)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONUTF8", "1")
        .env("PYTHONUNBUFFERED", "1");

    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start the local AI engine: {e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open backend input".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not open backend output".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not open backend error stream".to_string())?;

    let output_app = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            emit_backend_line(&output_app, &line);
        }
    });
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("backend error: {line}");
        }
    });

    *guard = Some(BackendProcess { child, stdin });
    Ok(())
}

#[tauri::command]
fn backend_send(command: Value, state: State<'_, BackendState>) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Backend lock is poisoned".to_string())?;
    let backend = guard
        .as_mut()
        .ok_or_else(|| "The local AI engine is not running".to_string())?;
    serde_json::to_writer(&mut backend.stdin, &command).map_err(|e| e.to_string())?;
    backend.stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    backend.stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Err(format!("The output no longer exists: {}", target.display()));
    }

    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer.exe");
        command.arg("/select,").arg(&target).creation_flags(CREATE_NO_WINDOW);
        command
            .spawn()
            .map_err(|e| format!("Could not open File Explorer: {e}"))?;
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Showing results in the file manager is only supported on Windows.".to_string())
    }
}

#[tauri::command]
fn open_creator_page() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("rundll32.exe");
        command
            .arg("url.dll,FileProtocolHandler")
            .arg(CREATOR_URL)
            .creation_flags(CREATE_NO_WINDOW);
        command
            .spawn()
            .map_err(|e| format!("Could not open the creator page: {e}"))?;
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Opening the creator page is only supported on Windows.".to_string())
    }
}

#[tauri::command]
fn backend_stop(state: State<'_, BackendState>) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Backend lock is poisoned".to_string())?;
    if let Some(mut backend) = guard.take() {
        let _ = backend.stdin.write_all(b"{\"type\":\"shutdown\"}\n");
        let _ = backend.stdin.flush();
        if backend.child.try_wait().ok().flatten().is_none() {
            let _ = backend.child.kill();
        }
        let _ = backend.child.wait();
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![
            backend_start,
            backend_send,
            backend_stop,
            reveal_in_folder,
            open_creator_page
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let state = window.state::<BackendState>();
                let _ = backend_stop(state);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running SPLTR");
}
