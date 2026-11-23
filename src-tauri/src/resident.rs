use std::{path::Path, sync::Mutex, time::Duration};
use tauri::{Emitter, Manager};

use crate::open_protocol::{
    OpenProtocol, OpenRequest, OpenResult, PagePhase, PageRegistration, WakeAction,
};

const BLANK_URL: &str = "about:blank";
const SESSION_SETTLE_MS: u64 = 500;
const REQUEST_EVENT: &str = "madu:open-requests";

struct ResidentInner {
    protocol: OpenProtocol,
    app_url: String,
}

pub struct ResidentState {
    inner: Mutex<ResidentInner>,
}

impl ResidentState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(ResidentInner {
                protocol: OpenProtocol::new(),
                app_url: String::new(),
            }),
        }
    }

    fn with_inner<R>(&self, f: impl FnOnce(&mut ResidentInner) -> R) -> R {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        f(&mut inner)
    }
}

fn notify_requests(app: &tauri::AppHandle) {
    // 只是提示：页面就绪时始终主动拉队列，因此通知丢失不丢请求。
    if let Err(error) = app.emit_to("main", REQUEST_EVENT, ()) {
        log::warn!("[open] notification failed, requests retained: {error}");
    }
}

pub fn enqueue(app: &tauri::AppHandle, source: &str, paths: Vec<String>, error: Option<String>) {
    if paths.is_empty() && error.is_none() {
        return;
    }
    let (id, ready) = app.state::<ResidentState>().with_inner(|inner| {
        let id = inner.protocol.enqueue(source, paths.clone(), error.clone());
        (id, inner.protocol.phase == PagePhase::Ready)
    });
    log::info!("[open] request_id={id} accepted source={source:?} paths={paths:?} error={error:?}");
    if ready {
        notify_requests(app);
    }
}

pub fn enqueue_launch(app: &tauri::AppHandle, source: &str, argv: &[String], cwd: &Path) {
    match crate::open_protocol::parse_launch(argv, cwd) {
        Ok(paths) => enqueue(app, source, paths, None),
        Err(error) => {
            log::warn!("[launch] invalid arguments: {error}");
            enqueue(app, source, Vec::new(), Some(error));
        }
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        for result in [window.unminimize(), window.show(), window.set_focus()] {
            if let Err(error) = result {
                log::warn!("[resident] show/focus failed: {error}");
            }
        }
    }
}

/// 导航、窗口操作和延迟卸载全部走主线程，状态变化与其副作用不允许交错。
pub fn resume_main_window(app: &tauri::AppHandle) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let (action, timeout, app_url) = handle.state::<ResidentState>().with_inner(|inner| {
            let (action, timeout) = inner.protocol.wake();
            (action, timeout, inner.app_url.clone())
        });
        log::info!("[resident] wake action={action:?}");
        match action {
            WakeAction::Show => {
                show_main_window(&handle);
                notify_requests(&handle);
            }
            WakeAction::Navigate => {
                let result = app_url.parse::<tauri::Url>().map_err(|error| error.to_string())
                    .and_then(|url| handle.get_webview_window("main")
                        .ok_or_else(|| "main window missing".to_string())?
                        .navigate(url).map_err(|error| error.to_string()));
                match result {
                    Ok(()) => log::info!("[resident] loading application page {app_url}"),
                    Err(error) => {
                        // 仍保留全部请求，下次唤醒可以重新尝试；不在空白页上 eval reload。
                        handle.state::<ResidentState>().with_inner(|inner| {
                            let ticket = inner.protocol.close();
                            inner.protocol.unload(ticket);
                        });
                        log::error!("[resident] navigation failed, requests retained: {error}");
                        show_main_window(&handle);
                    }
                }
            }
            WakeAction::Wait => {}
        }
        if let Some(ticket) = timeout {
            let timeout_handle = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(1));
                let main_handle = timeout_handle.clone();
                let _ = timeout_handle.run_on_main_thread(move || {
                    let show = main_handle.state::<ResidentState>()
                        .with_inner(|inner| inner.protocol.show_timeout(ticket));
                    if show {
                        log::warn!("[resident] paint timeout, showing window; requests still require completion");
                        show_main_window(&main_handle);
                    }
                });
            });
        }
    }) {
        log::error!("[resident] could not schedule wake: {error}");
    }
}

#[tauri::command]
pub fn frontend_begin(app: tauri::AppHandle, url: String) -> PageRegistration {
    let page = app.state::<ResidentState>().with_inner(|inner| {
        // 应用 URL 在页面加载时由宿主记录；该值只用于下一次从 about:blank 唤醒。
        if inner.app_url.is_empty() {
            inner.app_url = url;
        }
        inner.protocol.begin_page()
    });
    log::info!(
        "[open] page_id={} registered has_requests={}",
        page.page_id,
        page.has_requests
    );
    page
}

#[tauri::command]
pub fn frontend_ready(app: tauri::AppHandle, page_id: u64) -> bool {
    let ready = app
        .state::<ResidentState>()
        .with_inner(|inner| inner.protocol.ready(page_id));
    log::info!("[open] page_id={page_id} ready={ready}");
    ready
}

#[tauri::command]
pub fn next_open_request(app: tauri::AppHandle, page_id: u64) -> Option<OpenRequest> {
    let request = app
        .state::<ResidentState>()
        .with_inner(|inner| inner.protocol.claim(page_id));
    if let Some(request) = &request {
        log::info!(
            "[open] request_id={} page_id={page_id} delivered source={:?}",
            request.id,
            request.source
        );
    }
    request
}

#[tauri::command]
pub fn complete_open_request(
    app: tauri::AppHandle,
    page_id: u64,
    request_id: u64,
    result: OpenResult,
) -> bool {
    let request = app
        .state::<ResidentState>()
        .with_inner(|inner| inner.protocol.complete(page_id, request_id));
    if let Some(request) = request {
        let status = if result.succeeded() {
            "success"
        } else {
            "failed"
        };
        for outcome in &result.outcomes {
            log::info!(
                "[open] request_id={request_id} path={:?} error={:?}",
                outcome.path,
                outcome.error
            );
        }
        log::info!("[open] request_id={request_id} page_id={page_id} completed status={status} source={:?} error={:?}", request.source, result.error);
        true
    } else {
        log::warn!("[open] request_id={request_id} page_id={page_id} completion ignored (stale or already completed)");
        false
    }
}

/// 首帧显示信号与请求完成确认独立，旧页面的信号不能显示新一轮窗口。
#[tauri::command]
pub fn app_ready(app: tauri::AppHandle, page_id: u64) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let show = handle
            .state::<ResidentState>()
            .with_inner(|inner| inner.protocol.painted(page_id));
        if show {
            show_main_window(&handle);
            log::info!("[resident] page_id={page_id} painted, window shown");
        }
    });
}

pub fn on_page_load(webview: &tauri::Webview, payload: &tauri::webview::PageLoadPayload<'_>) {
    if webview.label() != "main" || payload.url().as_str() == BLANK_URL {
        // 空白导航的异步回调可能晚于下一次唤醒；卸载状态已由主线程设置，不能再覆盖它。
        return;
    }
    if payload.event() == tauri::webview::PageLoadEvent::Started {
        if let Some(state) = webview.app_handle().try_state::<ResidentState>() {
            state.with_inner(|inner| {
                inner.app_url = payload.url().to_string();
                inner.protocol.loading();
            });
            log::info!("[resident] page loading; previous execution lease invalidated");
        }
    }
}

pub fn install_close_handler(app: &tauri::App) {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(url) = window.url() {
            if url.as_str() != BLANK_URL {
                app.state::<ResidentState>()
                    .with_inner(|inner| inner.app_url = url.to_string());
            }
        }
        let close_window = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !close_to_tray_enabled() {
                    return;
                }
                api.prevent_close();
                let handle = close_window.app_handle().clone();
                let main_handle = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    if let Some(window) = main_handle.get_webview_window("main") {
                        let _ = window.hide();
                        let _ = window.eval("window.dispatchEvent(new CustomEvent('madu:hide-before-close'))");
                    }
                    let ticket = main_handle.state::<ResidentState>().with_inner(|inner| inner.protocol.close());
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(SESSION_SETTLE_MS));
                        let unload_handle = main_handle.clone();
                        let _ = main_handle.run_on_main_thread(move || {
                            let unload = unload_handle.state::<ResidentState>()
                                .with_inner(|inner| inner.protocol.unload(ticket));
                            if !unload {
                                log::info!("[resident] obsolete close ticket={ticket}, unload cancelled");
                                return;
                            }
                            if let Some(window) = unload_handle.get_webview_window("main") {
                                if let Err(error) = window.navigate(BLANK_URL.parse().expect("valid blank URL")) {
                                    log::error!("[resident] blank navigation failed: {error}");
                                }
                            }
                            log::info!("[resident] close ticket={ticket}, webview unloaded; unconfirmed requests retained");
                        });
                    });
                });
            }
        });
    }
}

fn close_to_tray_enabled() -> bool {
    dirs::data_dir()
        .map(|dir| dir.join("madureader").join("config.json"))
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|text| text.trim_start_matches('\u{feff}').to_string())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| value.get("closeToTray").and_then(|v| v.as_bool()))
        .unwrap_or(true)
}
