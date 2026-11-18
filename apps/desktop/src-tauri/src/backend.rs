use futures_util::{SinkExt, StreamExt};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::os::unix::process::CommandExt;
use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, Notify};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message as WsMessage},
};

const SERVICE: &str = "dev.akai.omni.providers";
pub struct Runtime {
    pub child: Child,
    pub stdin: ChildStdin,
}
pub struct Capture {
    id: String,
    sender: mpsc::Sender<WsMessage>,
    transcript: Arc<Mutex<crate::speech::Transcript>>,
    closed: Arc<Notify>,
    failed: Arc<AtomicBool>,
}
pub struct Backend {
    db: Mutex<Connection>,
    runtime: Mutex<Option<Runtime>>,
    capture: Mutex<Option<Capture>>,
    tts_epoch: Arc<AtomicU64>,
    runtime_epoch: Arc<AtomicU64>,
    capture_epoch: AtomicU64,
    capture_starting: AtomicBool,
    root: Mutex<Option<PathBuf>>,
}
impl Backend {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let path = app
            .path()
            .app_data_dir()
            .map_err(|_| "Cannot locate application data")?;
        std::fs::create_dir_all(&path).map_err(|_| "Cannot create Iris data folder")?;
        let db =
            Connection::open(path.join("omni.sqlite3")).map_err(|_| "Cannot open local history")?;
        let version: u32 = db
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|_| "Cannot inspect local storage version")?;
        if version > 1 {
            return Err(
                "This history belongs to a newer Iris version. Upgrade the app to open it safely."
                    .into(),
            );
        }
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version=1;").map_err(|_| "Cannot initialize local history")?;
        Ok(Self {
            db: Mutex::new(db),
            runtime: Mutex::new(None),
            capture: Mutex::new(None),
            tts_epoch: Arc::new(AtomicU64::new(0)),
            runtime_epoch: Arc::new(AtomicU64::new(0)),
            capture_epoch: AtomicU64::new(0),
            capture_starting: AtomicBool::new(false),
            root: Mutex::new(None),
        })
    }
    pub fn stop(&self) {
        self.runtime_epoch.fetch_add(1, Ordering::SeqCst);
        self.capture_epoch.fetch_add(1, Ordering::SeqCst);
        self.tts_epoch.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut root) = self.root.lock() {
            root.take();
        }
        if let Ok(mut slot) = self.capture.lock() {
            slot.take();
        }
        if let Ok(mut slot) = self.runtime.lock() {
            if let Some(mut runtime) = slot.take() {
                let _ = writeln!(runtime.stdin, "{}", json!({"command":"shutdown"}));
                unsafe {
                    libc::kill(-(runtime.child.id() as i32), libc::SIGTERM);
                }
                let started = std::time::Instant::now();
                while runtime.child.try_wait().ok().flatten().is_none()
                    && started.elapsed() < Duration::from_millis(500)
                {
                    std::thread::sleep(Duration::from_millis(10));
                }
                if runtime.child.try_wait().ok().flatten().is_none() {
                    unsafe {
                        libc::kill(-(runtime.child.id() as i32), libc::SIGKILL);
                    }
                }
                let _ = runtime.child.wait();
            }
        }
    }
}
fn key(provider: &str) -> Result<String, String> {
    provider_name(provider)?;
    security_framework::passwords::get_generic_password(SERVICE, provider)
        .map_err(|_| format!("Add your {provider} API key in Settings → Providers."))
        .and_then(|bytes| String::from_utf8(bytes).map_err(|_| "The stored key is invalid".into()))
}
fn provider_name(provider: &str) -> Result<(), String> {
    if ["deepgram", "elevenlabs"].contains(&provider) {
        Ok(())
    } else {
        Err("Unknown provider".into())
    }
}
#[tauri::command]
pub fn save_secret(provider: String, secret: String) -> Result<(), String> {
    provider_name(&provider)?;
    let secret = secret.trim();
    if secret.len() < 12 || secret.len() > 512 || secret.contains(['\n', '\r']) {
        return Err("Enter a valid API key".into());
    }
    security_framework::passwords::set_generic_password(SERVICE, &provider, secret.as_bytes())
        .map_err(|_| "macOS Keychain could not save this key".into())
}
#[tauri::command]
pub fn remove_secret(provider: String) -> Result<(), String> {
    provider_name(&provider)?;
    security_framework::passwords::delete_generic_password(SERVICE, &provider)
        .map_err(|_| "No key removed; the entry may already be absent".into())
}
#[tauri::command]
pub fn provider_status() -> Value {
    json!({"deepgram": key("deepgram").is_ok(), "elevenlabs": key("elevenlabs").is_ok()})
}
#[tauri::command]
pub async fn list_voices() -> Result<Value, String> {
    let response = reqwest::Client::new()
        .get("https://api.elevenlabs.io/v2/voices?page_size=100")
        .header("xi-api-key", key("elevenlabs")?)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "ElevenLabs could not be reached")?;
    if !response.status().is_success() {
        return Err(format!(
            "ElevenLabs rejected the request ({}). Check your key and account access.",
            response.status().as_u16()
        ));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|_| "Invalid voice response")?;
    Ok(json!(body["voices"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .take(100)
        .map(|v| json!({"id":v["voice_id"],"name":v["name"],"labels":v["labels"]}))
        .collect::<Vec<_>>()))
}
#[tauri::command]
pub fn load_workspace(state: State<Backend>) -> Result<Value, String> {
    let db = state.db.lock().map_err(|_| "Local history is busy")?;
    let value: String = db
        .query_row("SELECT value FROM kv WHERE key='workspace'", [], |r| {
            r.get(0)
        })
        .unwrap_or_else(|_| "null".into());
    serde_json::from_str(&value).map_err(|_| "Local history could not be read".into())
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Workspace {
    version: u8,
    layout: Value,
    preferences: Value,
    messages: Vec<Value>,
    activity: Vec<Value>,
    tasks: Vec<Value>,
}
#[tauri::command]
pub fn save_workspace(state: State<Backend>, workspace: Workspace) -> Result<(), String> {
    if workspace.version != 1
        || workspace.messages.len() > 500
        || workspace.activity.len() > 500
        || workspace.tasks.len() > 100
    {
        return Err("Workspace exceeds local storage limits".into());
    }
    let serialized = serde_json::to_string(&workspace).map_err(|_| "Invalid workspace")?;
    if serialized.len() > 4_000_000 {
        return Err("Workspace exceeds local storage limits".into());
    }
    state.db.lock().map_err(|_| "Local history is busy")?.execute("INSERT INTO kv(key,value) VALUES('workspace',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![serialized]).map_err(|_| "Could not save local history".into()).map(|_| ())
}
#[tauri::command]
pub fn clear_history(state: State<Backend>) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(|_| "Local history is busy")?
        .execute_batch(
            "DELETE FROM kv WHERE key='workspace'; PRAGMA wal_checkpoint(TRUNCATE); VACUUM;",
        )
        .map_err(|_| "Could not clear local history".into())
}

fn runtime_script(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../services/iris-runtime/bridge.py");
        if path.is_file() {
            return Ok(path);
        }
    }
    let path = app
        .path()
        .resource_dir()
        .map_err(|_| "Cannot locate runtime resources")?
        .join("runtime/bridge.py");
    if path.is_file() {
        Ok(path)
    } else {
        Err("The Iris runtime companion is missing. Rebuild the desktop package.".into())
    }
}
#[tauri::command]
pub fn runtime_connect(
    app: AppHandle,
    state: State<Backend>,
    provider: String,
) -> Result<(), String> {
    let provider = match provider.as_str() {
        "chatgpt" => "openai-codex",
        "hermes" => "hermes",
        _ => return Err("Unsupported provider selection".into()),
    };
    let mut slot = state.runtime.lock().map_err(|_| "Runtime is busy")?;
    if let Some(runtime) = slot.as_mut() {
        if runtime
            .child
            .try_wait()
            .map_err(|_| "Cannot inspect runtime")?
            .is_none()
        {
            writeln!(runtime.stdin, "{}", json!({"command":"snapshot"}))
                .and_then(|_| runtime.stdin.flush())
                .map_err(|_| "Cannot resynchronize Hermes")?;
            return Ok(());
        }
    }
    slot.take();
    let home = std::env::var("HOME").map_err(|_| "Cannot locate your Hermes installation")?;
    let executable = PathBuf::from(home).join(".local/bin/hermes");
    if !executable.is_file() {
        return Err(
            "Hermes was not found at ~/.local/bin/hermes. Install or repair Hermes first.".into(),
        );
    }
    let script = runtime_script(&app)?;
    let prepared = Command::new(&executable)
        .args(["--print-runtime-command", "--module", "runpy"])
        .output()
        .map_err(|_| "Cannot resolve the managed Hermes runtime")?;
    let mut argv: Vec<String> = serde_json::from_slice(&prepared.stdout)
        .map_err(|_| "Hermes did not return a valid managed runtime command")?;
    if !prepared.status.success() || argv.len() != 4 || argv[1] != "-I" || argv[2] != "-c" {
        return Err("Unsupported Hermes managed runtime launcher".into());
    }
    let (prefix, _) = argv[3]
        .rsplit_once("runpy.run_module(")
        .ok_or("Unsupported Hermes bootstrap format")?;
    argv[3] = format!(
        "{}runpy.run_path({}, run_name='__main__')",
        prefix,
        serde_json::to_string(&script.to_string_lossy())
            .map_err(|_| "Invalid runtime resource path")?
    );
    let mut child = Command::new(&argv[0])
        .args(&argv[1..])
        .args(["--provider", provider])
        .process_group(0)
        .current_dir(script.parent().unwrap())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Hermes could not start")?;
    let stdin = child.stdin.take().ok_or("Cannot connect to Hermes input")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Cannot connect to Hermes output")?;
    let epoch = state.runtime_epoch.fetch_add(1, Ordering::SeqCst) + 1;
    let generation = state.runtime_epoch.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if line.len() > 1_000_000 {
                continue;
            }
            if generation.load(Ordering::SeqCst) != epoch {
                break;
            }
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                if value.get("schemaVersion").and_then(Value::as_u64) == Some(1) {
                    let _ = app.emit("iris:runtime", value);
                }
            }
        }
        if generation.load(Ordering::SeqCst) == epoch {
            let _ = app.emit(
                "iris:disconnected",
                json!({"message":"Hermes connection closed. Reconnect to continue."}),
            );
        }
    });
    *slot = Some(Runtime { child, stdin });
    Ok(())
}
#[tauri::command]
pub fn runtime_command(state: State<Backend>, request: Value) -> Result<(), String> {
    let name = request["command"]
        .as_str()
        .ok_or("Invalid runtime command")?;
    if ![
        "send",
        "cancel",
        "approve",
        "deny",
        "snapshot",
        "revoke_root",
        "grant_domains",
        "delegate",
    ]
    .contains(&name)
    {
        return Err("Unsupported runtime command".into());
    }
    if name == "revoke_root" {
        if let Ok(mut root) = state.root.lock() {
            root.take();
        }
    }
    let text = serde_json::to_string(&request).map_err(|_| "Invalid runtime command")?;
    if text.len() > 250_000 {
        return Err("Command is too large".into());
    }
    let mut runtime = state.runtime.lock().map_err(|_| "Runtime is busy")?;
    let runtime = runtime.as_mut().ok_or("Connect Hermes first")?;
    writeln!(runtime.stdin, "{text}")
        .and_then(|_| runtime.stdin.flush())
        .map_err(|_| "Hermes is disconnected. Reconnect to continue.".into())
}
#[tauri::command]
pub fn runtime_disconnect(state: State<Backend>) {
    state.stop();
}
#[tauri::command]
pub async fn choose_root(app: AppHandle) -> Result<String, String> {
    let output=tauri::async_runtime::spawn_blocking(||Command::new("/usr/bin/osascript").args(["-e","POSIX path of (choose folder with prompt \"Select a project folder Iris may read. File changes still require individual approval.\")"]).output()).await.map_err(|_| "Folder picker could not start")?.map_err(|_| "Folder picker could not start")?;
    if !output.status.success() {
        return Err("Folder selection cancelled".into());
    }
    let path = String::from_utf8(output.stdout)
        .map_err(|_| "Invalid folder path")?
        .trim()
        .to_string();
    let state = app.state::<Backend>();
    let mut slot = state.runtime.lock().map_err(|_| "Runtime is busy")?;
    let runtime = slot
        .as_mut()
        .ok_or("Connect Hermes before selecting a folder")?;
    writeln!(
        runtime.stdin,
        "{}",
        json!({"command":"grant_root","path":path})
    )
    .and_then(|_| runtime.stdin.flush())
    .map_err(|_| "Hermes is disconnected")?;
    *state.root.lock().map_err(|_| "Folder scope is busy")? = Some(PathBuf::from(&path));
    Ok(path)
}
#[tauri::command]
pub fn reveal_artifact(state: State<Backend>, path: String) -> Result<(), String> {
    let root = state
        .root
        .lock()
        .map_err(|_| "Folder scope is busy")?
        .clone()
        .ok_or("Select a project folder first")?;
    let root = root
        .canonicalize()
        .map_err(|_| "The selected folder is no longer available")?;
    let target = root
        .join(path)
        .canonicalize()
        .map_err(|_| "This artifact no longer exists")?;
    if !target.starts_with(&root) || !target.is_file() {
        return Err("Artifact is outside the selected folder".into());
    }
    Command::new("/usr/bin/open")
        .arg("-R")
        .arg(target)
        .spawn()
        .map_err(|_| "Finder could not reveal the artifact")?;
    Ok(())
}
#[tauri::command]
pub fn open_source(url: String) -> Result<(), String> {
    if url.len() > 4096 {
        return Err("Source URL exceeds its limit".into());
    }
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid source URL")?;
    if !["https", "http"].contains(&parsed.scheme())
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Only web sources without embedded credentials can be opened".into());
    }
    Command::new("/usr/bin/open")
        .arg(parsed.as_str())
        .spawn()
        .map_err(|_| "The source could not be opened in your browser")?;
    Ok(())
}

#[tauri::command]
pub async fn stt_start(app: AppHandle, state: State<'_, Backend>) -> Result<String, String> {
    if state.capture_starting.swap(true, Ordering::SeqCst) {
        return Err("Microphone setup is already in progress".into());
    }
    struct Starting<'a>(&'a AtomicBool);
    impl Drop for Starting<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    let _starting = Starting(&state.capture_starting);
    let capture_epoch = state.capture_epoch.load(Ordering::SeqCst);
    if state
        .capture
        .lock()
        .map_err(|_| "Microphone is busy")?
        .is_some()
    {
        return Err("A capture is already active".into());
    }
    let mut request = "wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&endpointing=1200".into_client_request().map_err(|_| "Invalid speech configuration")?;
    request.headers_mut().insert(
        "Authorization",
        format!("Token {}", key("deepgram")?)
            .parse()
            .map_err(|_| "Invalid Deepgram key")?,
    );
    let (socket, _) = tokio::time::timeout(Duration::from_secs(15), connect_async(request))
        .await
        .map_err(|_| "Deepgram connection timed out")?
        .map_err(|_| "Deepgram connection failed. Check the key and network.")?;
    if state.capture_epoch.load(Ordering::SeqCst) != capture_epoch {
        return Err("Microphone setup was cancelled".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let event_id = id.clone();
    let (sender, mut receiver) = mpsc::channel::<WsMessage>(32);
    let transcript = Arc::new(Mutex::new(crate::speech::Transcript::default()));
    let output = transcript.clone();
    let closed = Arc::new(Notify::new());
    let notify = closed.clone();
    let failed = Arc::new(AtomicBool::new(false));
    let failure = failed.clone();
    *state.capture.lock().map_err(|_| "Microphone is busy")? = Some(Capture {
        id: id.clone(),
        sender,
        transcript,
        closed,
        failed,
    });
    tauri::async_runtime::spawn(async move {
        let (mut sink, mut stream) = socket.split();
        let mut closing = false;
        loop {
            tokio::select! {
                message=receiver.recv()=>match message {
                    Some(message)=>{
                        if let WsMessage::Text(text)=&message {closing=text.contains("CloseStream");}
                        if sink.send(message).await.is_err(){failure.store(true,Ordering::SeqCst);break;}
                    },
                    None=>{let _=sink.close().await;break;}
                },
                result=stream.next()=>match result {
                    Some(Ok(WsMessage::Text(text)))=>{
                        if let Ok(value)=serde_json::from_str::<Value>(&text){
                            if value["type"]=="Error"{failure.store(true,Ordering::SeqCst);break;}
                            if let Ok(mut transcript)=output.lock(){
                                if let Some((text,is_final,speech_final))=transcript.ingest(&value){
                                    let _=app.emit("iris:transcript",json!({"captureId":event_id,"text":text,"final":is_final,"speechFinal":speech_final}));
                                }
                            }
                        }
                    },
                    Some(Ok(WsMessage::Close(_)))|None=>{if !closing{failure.store(true,Ordering::SeqCst);}break;},
                    Some(Err(_))=>{failure.store(true,Ordering::SeqCst);break;},
                    _=>{}
                }
            }
        }
        notify.notify_one();
        if let Ok(mut slot) = app.state::<Backend>().capture.lock() {
            if slot.as_ref().is_some_and(|capture| capture.id == event_id) {
                slot.take();
            }
        }
        let _ = app.emit("iris:capture-ended", json!({"captureId":event_id}));
    });
    Ok(id)
}
#[tauri::command]
pub async fn stt_write(
    state: State<'_, Backend>,
    capture_id: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    if bytes.len() > 8192 {
        return Err("Audio frame is too large".into());
    }
    let sender = {
        let slot = state.capture.lock().map_err(|_| "Microphone is busy")?;
        let capture = slot
            .as_ref()
            .filter(|c| c.id == capture_id)
            .ok_or("Capture has ended")?;
        capture.sender.clone()
    };
    sender
        .try_send(WsMessage::Binary(bytes.into()))
        .map_err(|_| "Speech transport is congested; stop and retry".into())
}
#[tauri::command]
pub async fn stt_stop(state: State<'_, Backend>, capture_id: String) -> Result<String, String> {
    let capture = {
        let mut slot = state.capture.lock().map_err(|_| "Microphone is busy")?;
        if slot.as_ref().is_some_and(|c| c.id == capture_id) {
            slot.take().unwrap()
        } else {
            return Err("Capture has ended".into());
        }
    };
    capture
        .sender
        .send(WsMessage::Text(
            json!({"type":"CloseStream"}).to_string().into(),
        ))
        .await
        .map_err(|_| "Speech transport disconnected")?;
    tokio::time::timeout(Duration::from_secs(8), capture.closed.notified())
        .await
        .map_err(|_| "Speech finalization timed out. Review the transcript before retrying.")?;
    if capture.failed.load(Ordering::SeqCst) {
        return Err("Speech transport disconnected before finalization. Review the transcript before retrying.".into());
    }
    let transcript = capture
        .transcript
        .lock()
        .map_err(|_| "Transcript is busy")?;
    Ok(transcript.text())
}
#[tauri::command]
pub fn stt_cancel(state: State<Backend>) {
    state.capture_epoch.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut slot) = state.capture.lock() {
        slot.take();
    }
}
#[tauri::command]
pub fn tts_cancel(state: State<Backend>) {
    state.tts_epoch.fetch_add(1, Ordering::SeqCst);
}
#[tauri::command]
pub async fn tts_speak(
    app: AppHandle,
    state: State<'_, Backend>,
    text: String,
    voice_id: String,
    turn_id: String,
) -> Result<(), String> {
    let epoch = state.tts_epoch.fetch_add(1, Ordering::SeqCst) + 1;
    crate::speech::stream_tts(
        key("elevenlabs")?,
        &voice_id,
        &text,
        state.tts_epoch.clone(),
        epoch,
        |bytes| {
            app.emit(
                "iris:audio",
                json!({"turnId":turn_id,"bytes":bytes,"sampleRate":24000}),
            )
            .map_err(|_| "The audio playback connection is unavailable".into())
        },
    )
    .await
    .map(|_| ())
}

/// Explicit developer check: uses stored credentials internally, prints no secrets.
pub async fn voice_diagnostic(output: PathBuf) -> Result<Value, String> {
    let home = std::env::var("HOME").map_err(|_| "Cannot locate app preferences")?;
    let db = Connection::open_with_flags(
        PathBuf::from(home).join("Library/Application Support/dev.akai.omni/omni.sqlite3"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|_| "Open Iris and select a voice first")?;
    let stored: String = db
        .query_row("SELECT value FROM kv WHERE key='workspace'", [], |row| {
            row.get(0)
        })
        .map_err(|_| "Select a voice in Iris first")?;
    let workspace: Value =
        serde_json::from_str(&stored).map_err(|_| "Cannot read voice preferences")?;
    let voice = workspace["preferences"]["voiceId"]
        .as_str()
        .ok_or("Select a voice first")?;
    crate::speech::validate_voice_id(voice)?;
    let secret = key("elevenlabs")?;
    let response = reqwest::Client::new()
        .get(format!("https://api.elevenlabs.io/v1/voices/{voice}"))
        .header("xi-api-key", &secret)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "Cannot reach ElevenLabs")?;
    let metadata_status = response.status().as_u16();
    let metadata: Value = if response.status().is_success() {
        response
            .json()
            .await
            .map_err(|_| "Invalid voice metadata")?
    } else {
        json!({})
    };
    let mut pcm = Vec::new();
    crate::speech::stream_tts(
        secret,
        voice,
        "Hello. I am Iris. Your voice connection is ready.",
        Arc::new(AtomicU64::new(0)),
        0,
        |bytes| {
            pcm.extend(bytes);
            Ok(())
        },
    )
    .await?;
    let length = pcm.len() as u32;
    let mut wav = Vec::with_capacity(pcm.len() + 44);
    wav.extend(b"RIFF");
    wav.extend((36 + length).to_le_bytes());
    wav.extend(b"WAVEfmt ");
    wav.extend(16u32.to_le_bytes());
    wav.extend(1u16.to_le_bytes());
    wav.extend(1u16.to_le_bytes());
    wav.extend(24000u32.to_le_bytes());
    wav.extend(48000u32.to_le_bytes());
    wav.extend(2u16.to_le_bytes());
    wav.extend(16u16.to_le_bytes());
    wav.extend(b"data");
    wav.extend(length.to_le_bytes());
    wav.extend(&pcm);
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|_| "Cannot create the diagnostic output folder")?;
    }
    std::fs::write(&output, wav).map_err(|_| "Cannot save the voice audition")?;
    let transcript = crate::speech::recognize_sample(key("deepgram")?, &pcm).await?;
    Ok(
        json!({"voiceId":voice,"voiceName":metadata["name"],"labels":metadata["labels"],"audioFile":output,"sampleRate":24000,"seconds":pcm.len() as f64/48000.,"deepgramTranscript":transcript,"physicalMicrophoneTested":false,"metadataHttpStatus":metadata_status}),
    )
}
