//! The retained native library runs in Iris's process and uses its macOS permissions.
use std::{
    ffi::{CStr, CString},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, Manager};
type Callback = extern "C" fn(*const libc::c_char, *const libc::c_char, *const libc::c_char);
type Start = unsafe extern "C" fn(*const libc::c_char, Callback);
type Control = unsafe extern "C" fn(i32);
struct Native {
    _handle: usize,
    start: Start,
    control: Control,
}
static LIBRARY: OnceLock<Native> = OnceLock::new();
static TARGET: Mutex<Option<(AppHandle, String)>> = Mutex::new(None);
fn library(app: &AppHandle) -> Result<&'static Native, String> {
    if let Some(native) = LIBRARY.get() {
        return Ok(native);
    }
    let path = if cfg!(debug_assertions) {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../.local/native/libIrisWake.dylib")
    } else {
        app.path()
            .resource_dir()
            .map_err(|_| "Cannot locate wake resources")?
            .join("native/libIrisWake.dylib")
    };
    let path =
        CString::new(path.to_string_lossy().as_bytes()).map_err(|_| "Invalid native wake path")?;
    unsafe {
        let handle = libc::dlopen(path.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
        if handle.is_null() {
            return Err("The native wake listener could not load. Rebuild Iris.".into());
        }
        let start = libc::dlsym(handle, c"iris_wake_start".as_ptr());
        let control = libc::dlsym(handle, c"iris_wake_control".as_ptr());
        if start.is_null() || control.is_null() {
            return Err("The native wake listener is incompatible.".into());
        }
        let _ = LIBRARY.set(Native {
            _handle: handle as usize,
            start: std::mem::transmute::<*mut libc::c_void, Start>(start),
            control: std::mem::transmute::<*mut libc::c_void, Control>(control),
        });
    }
    LIBRARY
        .get()
        .ok_or("Cannot initialize local wake listening".into())
}
extern "C" fn callback(
    id: *const libc::c_char,
    status: *const libc::c_char,
    message: *const libc::c_char,
) {
    if id.is_null() || status.is_null() || message.is_null() {
        return;
    }
    let (id, status, message) = unsafe {
        (
            CStr::from_ptr(id).to_string_lossy(),
            CStr::from_ptr(status).to_string_lossy(),
            CStr::from_ptr(message).to_string_lossy(),
        )
    };
    if let Ok(target) = TARGET.lock() {
        if let Some((app, active)) = target.as_ref() {
            if active == id.as_ref() {
                let _ = app.emit(
                    "iris:wake",
                    serde_json::json!({"activationId":active,"status":status,"message":message}),
                );
            }
        }
    }
}
#[tauri::command]
pub fn wake_start(app: AppHandle, activation_id: String) -> Result<(), String> {
    uuid::Uuid::parse_str(&activation_id).map_err(|_| "Invalid wake activation")?;
    let native = library(&app)?;
    let id = CString::new(activation_id.clone()).map_err(|_| "Invalid wake activation")?;
    *TARGET.lock().map_err(|_| "Wake listener is busy")? = Some((app, activation_id));
    unsafe { (native.start)(id.as_ptr(), callback) };
    Ok(())
}
#[tauri::command]
pub fn wake_control(activation_id: String, action: String) -> Result<(), String> {
    let mut target = TARGET.lock().map_err(|_| "Wake listener is busy")?;
    if !target.as_ref().is_some_and(|(_, id)| id == &activation_id) {
        return Ok(());
    }
    let control = match action.as_str() {
        "pause" => 1,
        "resume" => 2,
        "stop" => 0,
        _ => return Err("Unknown wake control".into()),
    };
    if let Some(native) = LIBRARY.get() {
        unsafe { (native.control)(control) }
    }
    if control == 0 {
        target.take();
    }
    Ok(())
}
pub fn stop() {
    if let Some(native) = LIBRARY.get() {
        unsafe { (native.control)(0) }
    }
    if let Ok(mut target) = TARGET.lock() {
        target.take();
    }
}
