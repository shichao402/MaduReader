use std::env;
use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// 托盘图标（由 npm run icons 生成同步到 src-tauri/icons/，编译期嵌入）
const TRAY_DARK: &[u8] = include_bytes!("../icons/tray-dark.png");
const TRAY_LIGHT: &[u8] = include_bytes!("../icons/tray-light.png");

/// 常驻 + 快速唤醒协议：
/// - 点 X 关窗（或 Alt+F4）→ 窗口立即隐藏（体感即关），进程与 WebView2 环境常驻；500ms
///   （前端会话落盘窗口）后把 WebView 导航到 about:blank，DOM/JS 堆整体释放。
///   是否驻留由设置项 closeToTray 控制。
/// - 再次启动 exe / 双击 md → single-instance 把参数转发给常驻进程后本进程立即退出，常驻进程
///   导航回应用页面，前端 init 通过 get_pending_open 拿到路径直接打开。
/// - 托盘左键 / "显示主窗口" → 内容已卸载则先导航回来，暂不显示窗口；等前端 init 完成、
///   画面绘制后上报 app_ready 再显示（超时兜底强制显示），避免白屏/半渲染画面外露。
const BLANK_URL: &str = "about:blank";
/// 与前端会话防抖间隔（500ms）一致，保证隐藏前 session.json 已落盘
const SESSION_SETTLE_MS: u64 = 500;

/// 可变运行状态（Mutex 内部可变性：Tauri State 只提供共享引用）
struct ResidentInner {
    /// WebView 内容是否已卸载（隐藏 + about:blank），唤醒时据此决定是否导航回来
    unloaded: bool,
    /// 唤醒时窗口处于隐藏等待状态：app_ready 上报后再显示，超时兜底
    pending_show: bool,
    /// 应用页面前端 URL（dev 为 devUrl、release 为应用协议地址），唤醒导航用
    app_url: String,
    /// single-instance 转发的待打开路径，页面导航回来后由前端 init 消费（consume-once）
    pending_open: Option<String>,
    /// 原始命令行参数只消费一次：常驻唤醒后页面重载会再次调 get_args，
    /// 不能再返回旧 argv，否则会反复打开启动参数文件而不是恢复最新会话
    args_consumed: bool,
    /// 关闭卸载流程的 500ms 等待窗口内若发生二次启动，取消隐藏/卸载
    cancel_unload: bool,
}

impl ResidentInner {
    fn new() -> Self {
        Self {
            unloaded: false,
            pending_show: false,
            app_url: String::new(),
            pending_open: None,
            args_consumed: false,
            cancel_unload: false,
        }
    }
}

struct ResidentState {
    inner: Mutex<ResidentInner>,
}

impl ResidentState {
    fn new() -> Self {
        Self {
            inner: Mutex::new(ResidentInner::new()),
        }
    }

    fn with_inner<R>(&self, f: impl FnOnce(&mut ResidentInner) -> R) -> R {
        let mut guard = self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        f(&mut guard)
    }
}

/// 读取「关闭窗口时驻留托盘」设置（config.json 由前端 write_data_file 维护）。
/// 文件缺失/损坏/字段缺失时默认驻留（true）。
fn close_to_tray_enabled() -> bool {
    dirs::data_dir()
        .map(|dir| dir.join("madureader").join("config.json"))
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|text| text.trim_start_matches('\u{feff}').to_string())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| value.get("closeToTray").and_then(|v| v.as_bool()))
        .unwrap_or(true)
}

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 前端已在运行时，直接推 madu:open-path 事件打开路径（含目录/文件逻辑由前端统一处理）
fn emit_open_path(app: &tauri::AppHandle, path: &str) {
    if let Some(win) = app.get_webview_window("main") {
        let payload = serde_json::to_string(&path).unwrap_or_else(|_| "\"\"".to_string());
        let _ = win.eval(&format!(
            "window.dispatchEvent(new CustomEvent('madu:open-path', {{ detail: {payload} }}))"
        ));
    }
}

/// 唤醒主窗口：若 WebView 内容已卸载（about:blank），先导航回应用页面再聚焦。
/// 页面重新加载后前端 init 会自行调用 get_pending_open 处理待打开路径或会话恢复。
/// 已卸载时窗口保持隐藏，等前端绘制完成后上报 app_ready 再显示（1s 超时兜底），
/// 避免白屏/半渲染画面外露（画面撕裂感）。
fn resume_main_window(app: &tauri::AppHandle) {
    let mut wait_ready = false;
    if let Some(state) = app.try_state::<ResidentState>() {
        let app_url = state.with_inner(|inner| {
            if inner.unloaded {
                inner.unloaded = false;
                inner.pending_show = true;
                wait_ready = true;
            }
            inner.app_url.clone()
        });
        if let Some(win) = app.get_webview_window("main") {
            match app_url.parse::<tauri::Url>() {
                Ok(url) => {
                    let _ = win.navigate(url);
                    log::info!("[resident] webview navigating back to {}", app_url);
                }
                Err(_) => {
                    let _ = win.eval("window.location.reload()");
                }
            }
        }
        if wait_ready {
            let handle = app.clone();
            std::thread::spawn(move || {
                for _ in 0..20 {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    let still_waiting = handle
                        .try_state::<ResidentState>()
                        .map(|s| s.with_inner(|inner| inner.pending_show))
                        .unwrap_or(false);
                    if !still_waiting {
                        return;
                    }
                }
                // 超时兜底：前端迟迟未上报（如异常），强制显示避免窗口"消失"
                handle
                    .try_state::<ResidentState>()
                    .map(|s| s.with_inner(|inner| inner.pending_show = false));
                focus_main_window(&handle);
                if let Some(win) = handle.get_webview_window("main") {
                    let _ = win.show();
                }
                log::warn!("[resident] app_ready timeout, force show window");
            });
        }
    }
    focus_main_window(app);
}

/// 前端 init 完成、首帧绘制后调用：若窗口正等待显示，则显示并聚焦。
#[tauri::command]
fn app_ready(app: tauri::AppHandle) {
    if let Some(state) = app.try_state::<ResidentState>() {
        let should_show = state.with_inner(|inner| {
            if inner.pending_show {
                inner.pending_show = false;
                true
            } else {
                false
            }
        });
        if should_show {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
            log::info!("[resident] app_ready, window shown");
        }
    }
}

#[tauri::command]
fn get_args(app: tauri::AppHandle) -> Vec<String> {
    if let Some(state) = app.try_state::<ResidentState>() {
        let already = state.with_inner(|inner| {
            if inner.args_consumed {
                true
            } else {
                inner.args_consumed = true;
                false
            }
        });
        if already {
            return Vec::new();
        }
    }
    env::args().skip(1).collect()
}

/// 前端 init 时上报自己页面的真实 URL（dev 为 devUrl、release 为应用协议地址）。
/// 卸载后再唤醒时 WebView 已在 about:blank，JS 上下文已销毁，只能靠这个记录导航回去。
#[tauri::command]
fn set_app_url(app: tauri::AppHandle, url: String) {
    if url.starts_with("http://")
        || url.starts_with("https://")
        || url.starts_with("tauri://")
        || url.starts_with("http://tauri.localhost")
    {
        if let Some(state) = app.try_state::<ResidentState>() {
            state.with_inner(|inner| inner.app_url = url);
        }
    }
}

/// 前端启动后询问：本次唤醒是否有待打开的路径（single-instance 转发）。
/// 取走即清空（consume-once）；None 表示走会话恢复。
#[tauri::command]
fn get_pending_open(app: tauri::AppHandle) -> Option<String> {
    app.try_state::<ResidentState>()
        .and_then(|state| state.with_inner(|inner| inner.pending_open.take()))
}

#[tauri::command]
fn app_data_dir() -> Result<String, String> {
    dirs::data_dir()
        .map(|dir| {
            let path = dir.join("madureader");
            let mut s = path.to_string_lossy().into_owned();
            if !s.ends_with(std::path::MAIN_SEPARATOR) {
                s.push(std::path::MAIN_SEPARATOR);
            }
            s
        })
        .ok_or_else(|| "Could not resolve app data directory".to_string())
}

/// 将用户显式授权的路径（目录或文件）加入 fs 读取作用域。
/// 目录递归放行，覆盖所有层级的子目录与文件。
/// 仅可由前端在用户通过对话框选择或拖拽文件后调用，不做无差别的全盘授权。
#[tauri::command]
fn add_allowed_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_fs::FsExt as _;
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("path does not exist: {path}"));
    }
    let scope = app.fs_scope();
    let result = if p.is_dir() {
        scope.allow_directory(&p, true)
    } else {
        scope.allow_file(&p)
    };
    result.map_err(|e| format!("failed to allow path: {e}"))
}

/// 应用数据文件统一由 Rust 侧读写，绕开前端 fs 插件作用域限制，
/// 写入前自动创建目录，避免持久化被静默拦截导致设置丢失。
/// 仅允许 madureader 数据目录下的普通文件名，拒绝任何路径分隔符。
fn data_file_path(file_name: &str) -> Result<std::path::PathBuf, String> {
    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains("..")
    {
        return Err(format!("invalid file name: {file_name}"));
    }
    let dir = dirs::data_dir()
        .ok_or_else(|| "Could not resolve app data directory".to_string())?
        .join("madureader");
    Ok(dir.join(file_name))
}

#[tauri::command]
fn read_data_file(file_name: String) -> Result<String, String> {
    let path = data_file_path(&file_name)?;
    std::fs::read_to_string(&path).map_err(|e| format!("failed to read {file_name}: {e}"))
}

#[tauri::command]
fn write_data_file(file_name: String, content: String) -> Result<(), String> {
    let path = data_file_path(&file_name)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("failed to create dir: {e}"))?;
    }
    std::fs::write(&path, content).map_err(|e| format!("failed to write {file_name}: {e}"))
}

/// ---------- 文件关联（跨平台） ----------
/// 打包层：tauri.conf.json bundle.fileAssociations 声明 .md/.markdown（NSIS 注册表 /
/// macOS Info.plist / Linux desktop 文件 MimeType），安装即出现在系统"打开方式"里。
/// 运行时层：下面三个命令供设置页在便携版/免安装场景主动注册与设为默认。

const ASSOC_EXTS: [&str; 2] = ["md", "markdown"];
#[cfg(windows)]
const ASSOC_PROGID: &str = "MaduReader.md";

#[derive(serde::Serialize)]
struct AssocStatus {
    ext: String,
    /// 本机的打开方式列表里是否已注册 Ma读（ProgID / bundle id / desktop 入口存在）
    registered: bool,
    /// 是否已是系统默认打开方式
    is_default: bool,
    /// 当前默认打开程序的可读标识
    current_handler: Option<String>,
}

#[cfg(windows)]
mod windows_assoc {
    use super::{AssocStatus, ASSOC_EXTS, ASSOC_PROGID};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY,
        HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE,
        REG_SZ,
    };
    use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn reg_set_string(
        root: HKEY,
        subkey: &str,
        value_name: Option<&str>,
        data: &str,
    ) -> Result<(), String> {
        unsafe {
            let sub_w = to_wide(subkey);
            let mut hk: HKEY = std::ptr::null_mut();
            let err = RegCreateKeyExW(
                root,
                sub_w.as_ptr(),
                0,
                std::ptr::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                std::ptr::null(),
                &mut hk,
                std::ptr::null_mut(),
            );
            if err != 0 {
                return Err(format!("RegCreateKeyExW({subkey}) failed: {err}"));
            }
            let name_w: Vec<u16> = match value_name {
                Some(n) => to_wide(n),
                None => Vec::new(),
            };
            let name_ptr = if value_name.is_some() {
                name_w.as_ptr()
            } else {
                std::ptr::null()
            };
            let mut data_w = to_wide(data);
            let err = RegSetValueExW(
                hk,
                name_ptr,
                0,
                REG_SZ,
                data_w.as_mut_ptr() as *const u8,
                (data_w.len() * 2) as u32,
            );
            RegCloseKey(hk);
            if err != 0 {
                return Err(format!("RegSetValueExW({subkey}) failed: {err}"));
            }
            Ok(())
        }
    }

    fn reg_get_string(root: HKEY, subkey: &str, value_name: &str) -> Option<String> {
        unsafe {
            let sub_w = to_wide(subkey);
            let mut hk: HKEY = std::ptr::null_mut();
            if RegOpenKeyExW(root, sub_w.as_ptr(), 0, KEY_READ, &mut hk) != 0 {
                return None;
            }
            let name_w = to_wide(value_name);
            let mut buf = [0u16; 1024];
            let mut data_len = (buf.len() * 2) as u32;
            let err = RegQueryValueExW(
                hk,
                name_w.as_ptr(),
                std::ptr::null(),
                std::ptr::null_mut(),
                buf.as_mut_ptr() as *mut u8,
                &mut data_len,
            );
            RegCloseKey(hk);
            if err != 0 {
                return None;
            }
            let chars = (data_len as usize / 2).min(buf.len());
            Some(
                String::from_utf16_lossy(&buf[..chars])
                    .trim_end_matches('\0')
                    .to_string(),
            )
        }
    }

    fn progid_registered() -> bool {
        reg_get_string(
            HKEY_CURRENT_USER,
            r"Software\Classes\MaduReader.md\shell\open\command",
            "",
        )
        .is_some()
    }

    fn current_handler(ext: &str) -> Option<String> {
        let user_choice = format!(
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.{ext}\UserChoice"
        );
        reg_get_string(HKEY_CURRENT_USER, &user_choice, "ProgId")
            .or_else(|| reg_get_string(HKEY_CLASSES_ROOT, &format!(".{ext}"), ""))
    }

    pub fn status() -> Vec<AssocStatus> {
        let registered = progid_registered();
        ASSOC_EXTS
            .iter()
            .map(|ext| {
                let handler = current_handler(ext);
                AssocStatus {
                    ext: ext.to_string(),
                    registered,
                    is_default: handler.as_deref() == Some(ASSOC_PROGID),
                    current_handler: handler,
                }
            })
            .collect()
    }

    /// 写入 HKCU ProgID 并加入扩展名的"打开方式"列表（无需管理员权限）。
    /// 真正的 UserChoice 默认项受系统 hash 保护无法直接写，注册后由用户在
    /// 系统"默认应用"设置或资源管理器"打开方式"里一键选择。
    pub fn set(ext: &str) -> Result<(), String> {
        if !ASSOC_EXTS.contains(&ext) {
            return Err(format!("不支持的扩展名: {ext}"));
        }
        let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
        let exe_str = exe.to_string_lossy().to_string();
        reg_set_string(
            HKEY_CURRENT_USER,
            r"Software\Classes\MaduReader.md",
            None,
            "Ma读 Markdown 文档",
        )?;
        reg_set_string(
            HKEY_CURRENT_USER,
            r"Software\Classes\MaduReader.md\shell\open\command",
            None,
            &format!("\"{exe_str}\" \"%1\""),
        )?;
        reg_set_string(
            HKEY_CURRENT_USER,
            r"Software\Classes\MaduReader.md\DefaultIcon",
            None,
            &format!("{exe_str},0"),
        )?;
        let open_with = format!(r"Software\Classes\.{ext}\OpenWithProgids");
        reg_set_string(HKEY_CURRENT_USER, &open_with, Some(ASSOC_PROGID), "")?;
        unsafe {
            SHChangeNotify(SHCNE_ASSOCCHANGED as i32, SHCNF_IDLIST, std::ptr::null(), std::ptr::null());
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod macos_assoc {
    use super::{AssocStatus, ASSOC_EXTS};
    use core_foundation::base::{CFStringRef, TCFType};
    use core_foundation::string::CFString;

    /// 系统内置的 Markdown UTI（macOS 10.13+）
    const UTI_MARKDOWN: &str = "net.daringfireball.markdown";
    const K_LS_ROLES_ALL: u32 = 0xffff_ffff;

    #[link(name = "CoreServices", kind = "framework")]
    unsafe extern "C" {
        fn LSSetDefaultRoleHandlerForContentType(
            in_content_type: CFStringRef,
            in_roles: u32,
            in_handler_bundle_id: CFStringRef,
        );
        fn LSCopyDefaultRoleHandlerForContentType(
            in_content_type: CFStringRef,
            in_roles: u32,
        ) -> CFStringRef;
    }

    pub fn status(self_bundle_id: &str) -> Vec<AssocStatus> {
        let uti = CFString::new(UTI_MARKDOWN);
        let handler = unsafe {
            let raw =
                LSCopyDefaultRoleHandlerForContentType(uti.as_concrete_TypeRef(), K_LS_ROLES_ALL);
            if raw.is_null() {
                None
            } else {
                Some(CFString::wrap_under_create_rule(raw).to_string())
            }
        };
        let is_default = handler.as_deref() == Some(self_bundle_id);
        ASSOC_EXTS
            .iter()
            .map(|ext| AssocStatus {
                ext: ext.to_string(),
                registered: true,
                is_default,
                current_handler: handler.clone(),
            })
            .collect()
    }

    pub fn set(self_bundle_id: &str) -> Result<(), String> {
        let uti = CFString::new(UTI_MARKDOWN);
        let bundle = CFString::new(self_bundle_id);
        unsafe {
            LSSetDefaultRoleHandlerForContentType(
                uti.as_concrete_TypeRef(),
                K_LS_ROLES_ALL,
                bundle.as_concrete_TypeRef(),
            );
        }
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod linux_assoc {
    use super::{AssocStatus, ASSOC_EXTS};
    use std::path::PathBuf;
    use std::process::Command;

    const MIME: &str = "text/markdown";
    const DESKTOP_CANDIDATES: [&str; 3] = [
        "madureader.desktop",
        "MaduReader.desktop",
        "com.shichao402.madureader.desktop",
    ];

    fn desktop_search_dirs() -> Vec<PathBuf> {
        let mut dirs = vec![
            PathBuf::from("/usr/share/applications"),
            PathBuf::from("/usr/local/share/applications"),
        ];
        if let Ok(home) = std::env::var("HOME") {
            dirs.push(PathBuf::from(home).join(".local/share/applications"));
        }
        dirs
    }

    fn installed_desktop() -> Option<String> {
        for dir in desktop_search_dirs() {
            for cand in DESKTOP_CANDIDATES {
                if dir.join(cand).exists() {
                    return Some(cand.to_string());
                }
            }
        }
        None
    }

    fn query_default() -> Option<String> {
        Command::new("xdg-mime")
            .args(["query", "default", MIME])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
    }

    pub fn status() -> Vec<AssocStatus> {
        let desktop = installed_desktop();
        let current = query_default();
        let is_default = desktop
            .as_deref()
            .zip(current.as_deref())
            .map(|(d, c)| d == c)
            .unwrap_or(false);
        ASSOC_EXTS
            .iter()
            .map(|ext| AssocStatus {
                ext: ext.to_string(),
                registered: desktop.is_some(),
                is_default,
                current_handler: current
                    .clone()
                    .map(|s| s.trim_end_matches(".desktop").to_string()),
            })
            .collect()
    }

    pub fn set() -> Result<(), String> {
        let desktop = installed_desktop().ok_or_else(|| {
            "未找到已安装的桌面入口，请通过 deb/rpm 安装包安装后再关联".to_string()
        })?;
        let output = Command::new("xdg-mime")
            .args(["default", &desktop, MIME])
            .output()
            .map_err(|e| format!("xdg-mime 执行失败: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "xdg-mime 失败: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Ok(())
    }
}

/// 查询各扩展名的文件关联状态（设置页展示）
#[tauri::command]
fn association_status(app: tauri::AppHandle) -> Vec<AssocStatus> {
    #[cfg(windows)]
    {
        let _ = &app;
        return windows_assoc::status();
    }
    #[cfg(target_os = "macos")]
    {
        return macos_assoc::status(&app.config().identifier);
    }
    #[cfg(target_os = "linux")]
    {
        let _ = &app;
        return linux_assoc::status();
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = &app;
        Vec::new()
    }
}

/// 注册/设为默认：Windows 写 HKCU ProgID 并加入"打开方式"列表；
/// macOS 直接调 LaunchServices 设为 UTI 默认；Linux 调 xdg-mime 写 mimeapps.list
#[tauri::command]
fn set_file_association(app: tauri::AppHandle, ext: String) -> Result<(), String> {
    let _ = &ext;
    #[cfg(windows)]
    {
        let _ = &app;
        return windows_assoc::set(&ext);
    }
    #[cfg(target_os = "macos")]
    {
        return macos_assoc::set(&app.config().identifier);
    }
    #[cfg(target_os = "linux")]
    {
        let _ = &app;
        return linux_assoc::set();
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        Err("unsupported platform".to_string())
    }
}

/// Windows：打开系统"默认应用"设置页（注册后设 UserChoice 默认项需用户在此选择）
#[tauri::command]
fn open_default_apps_settings() -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:defaultapps"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("打开系统设置失败: {e}"))?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

/// 前端主题切换时同步托盘图标深浅（dark=true 用白色图形）。
#[tauri::command]
fn set_tray_theme(app: tauri::AppHandle, dark: bool) -> Result<(), String> {
    let icon = decode_tray_icon(if dark { TRAY_DARK } else { TRAY_LIGHT })
        .map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn decode_tray_icon(bytes: &'static [u8]) -> tauri::Result<tauri::image::Image<'static>> {
    tauri::image::Image::from_bytes(bytes).map(|img| img.to_owned())
}

/// 进程创建到 run() 进入的耗时（exe 加载 + 静态初始化段，Defender 实时扫描主要发生在这一段）。
/// 通过 GetProcessTimes 取进程创建时刻，与当前时间做差；日志插件未就绪，由 setup 内统一输出。
#[cfg(windows)]
fn process_start_elapsed_ms() -> Option<u64> {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

    let mut creation = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let mut exit = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let mut kernel = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let mut user = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };

    unsafe {
        if GetProcessTimes(GetCurrentProcess(), &mut creation, &mut exit, &mut kernel, &mut user) == 0 {
            return None;
        }
    }

    let created = ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64;
    let now_unix_100ns = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos() as u64
        / 100;
    // FILETIME 纪元（1601-01-01）与 UNIX 纪元相差的 100ns 数
    const EPOCH_DIFF_100NS: u64 = 116_444_736_000_000_000;
    let now_filetime = now_unix_100ns + EPOCH_DIFF_100NS;
    if now_filetime <= created {
        return None;
    }
    Some((now_filetime - created) / 10_000)
}

pub fn run() {
    let boot_start = std::time::Instant::now();
    #[cfg(windows)]
    let process_load_ms = process_start_elapsed_ms();
    tauri::Builder::default()
        // 单实例常驻：二次启动（含双击 md / 命令行带参）把 argv 转发给常驻进程后立即退出。
        // 必须最先注册，尽早拦截二次启动。
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // 二次启动发生时，若关闭卸载流程还在等待窗口内，取消它
            if let Some(state) = app.try_state::<ResidentState>() {
                state.with_inner(|inner| inner.cancel_unload = true);
            }
            // 插件把 cwd 与 exe 路径一并放进 argv：argv[0]=cwd、argv[1]=exe 路径、argv[2]=真实参数。
            // 跳过与当前进程 exe 相同的项，取第一个真实目标（兼容插件未来调整约定）。
            let exe_path = std::env::current_exe()
                .ok()
                .map(|p| p.to_string_lossy().to_lowercase());
            let target = argv
                .iter()
                .skip(1)
                .find(|a| {
                    let lower = a.to_lowercase();
                    Some(lower.as_str()) != exe_path.as_deref()
                })
                .cloned();
            let was_unloaded = app
                .try_state::<ResidentState>()
                .map(|s| s.with_inner(|inner| inner.unloaded))
                .unwrap_or(false);
            // 内容已卸载：记下待打开路径，页面导航回来后由 init 调 get_pending_open 消费
            if was_unloaded {
                if let (Some(state), Some(path)) = (app.try_state::<ResidentState>(), target.as_ref()) {
                    state.with_inner(|inner| inner.pending_open = Some(path.clone()));
                }
                // 窗口此刻是隐藏的，显示动作交给 resume_main_window 的 app_ready 流程
            } else {
                // 内容未卸载、窗口可见：直接置顶显示（focus_main_window 走 unminimize+set_focus）
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                }
            }
            resume_main_window(app);
            // 内容未卸载：前端已在运行，直接推事件打开文件（不置 pending，避免残留污染下次唤醒）
            if !was_unloaded {
                if let Some(path) = target {
                    emit_open_path(app, &path);
                }
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: Some("madureader".into()) },
                ))
                .max_file_size(512_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        // 探针插件：注册在 log 之后，其 initialize 完成即「插件全部就绪」，
        // 与 setup entered 之差即「主窗口 + WebView2 创建」耗时
        .plugin(
            tauri::plugin::Builder::new("startup-probe")
                .setup(move |_app, _api: tauri::plugin::PluginApi<tauri::Wry, ()>| {
                    log::info!("[perf] rust: plugins ready at +{:?}", boot_start.elapsed());
                    Ok(())
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_args,
            get_pending_open,
            set_app_url,
            app_ready,
            app_data_dir,
            add_allowed_path,
            set_tray_theme,
            read_data_file,
            write_data_file,
            association_status,
            set_file_association,
            open_default_apps_settings
        ])
        .setup(move |app| {
            #[cfg(windows)]
            if let Some(ms) = process_load_ms {
                log::info!("[perf] rust: process->run() = {}ms (exe 加载/静态初始化段)", ms);
            }
            log::info!("[perf] rust: setup entered at +{:?}", boot_start.elapsed());

            app.manage(ResidentState::new());

            // 记录应用页面前端 URL（dev 为 devUrl，release 为 tauri://localhost），唤醒导航用；
            // 前端 init 时还会通过 set_app_url 上报更可靠的地址
            if let Some(win) = app.get_webview_window("main") {
                if let Ok(url) = win.url() {
                    let text = url.to_string();
                    app.state::<ResidentState>().with_inner(|inner| {
                        if !text.starts_with("about:") {
                            inner.app_url = text;
                        }
                    });
                }
            }

            #[cfg(desktop)]
            {
                let show =
                    MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &quit])?;
                let icon = decode_tray_icon(TRAY_LIGHT)?;
                TrayIconBuilder::with_id("main-tray")
                    .icon(icon)
                    .tooltip("Ma读")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => resume_main_window(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            resume_main_window(tray.app_handle());
                        }
                    })
                    .build(app)?;
            }

            // 常驻核心：拦截点 X 关闭。closeToTray 开启时立即隐藏窗口（体感即关），
            // 隐藏后通知前端落盘会话，500ms 后卸载 WebView 内容（导航到 about:blank）。
            if let Some(win) = app.get_webview_window("main") {
                let win_for_flush = win.clone();
                let win_for_hide = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if !close_to_tray_enabled() {
                            return;
                        }
                        api.prevent_close();
                        // 立即隐藏：用户点 X 的那一刻窗口就消失，体感与"关闭"一致
                        let _ = win_for_hide.hide();
                        // 窗口已隐藏，此刻通知前端立即落盘会话
                        let _ = win_for_flush.eval(
                            "window.dispatchEvent(new CustomEvent('madu:hide-before-close'))",
                        );
                        let hide_win = win_for_hide.clone();
                        std::thread::spawn(move || {
                            // 给前端写入 session.json 留出落盘窗口（窗口已隐藏，无感知）
                            std::thread::sleep(std::time::Duration::from_millis(SESSION_SETTLE_MS));
                            // 等待窗口内发生二次启动：放弃卸载，保持窗口可见
                            let cancelled = hide_win
                                .app_handle()
                                .try_state::<ResidentState>()
                                .map(|s| {
                                    s.with_inner(|inner| std::mem::replace(&mut inner.cancel_unload, false))
                                })
                                .unwrap_or(false);
                            if cancelled {
                                log::info!("[resident] close cancelled by relaunch, window stays visible");
                                return;
                            }
                            // 内容卸载：导航到空白页，释放 DOM/JS 堆；唤醒时导航回来重新初始化
                            if let Ok(blank) = tauri::Url::parse(BLANK_URL) {
                                let _ = hide_win.navigate(blank);
                            }
                            if let Some(state) =
                                hide_win.app_handle().try_state::<ResidentState>()
                            {
                                state.with_inner(|inner| inner.unloaded = true);
                            }
                            log::info!("[resident] window hidden, webview content unloaded");
                        });
                    }
                });
            }

            log::info!("[perf] rust: setup done at +{:?}", boot_start.elapsed());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
