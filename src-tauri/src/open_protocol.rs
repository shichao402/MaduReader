//! 常驻进程拥有打开请求；WebView 只持有可失效的执行租约。
use std::{collections::VecDeque, path::Path};

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    pub id: u64,
    pub source: String,
    pub paths: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRegistration {
    pub page_id: u64,
    pub has_requests: bool,
}

#[derive(Debug, serde::Deserialize)]
pub struct PathOutcome {
    pub path: String,
    pub error: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct OpenResult {
    pub error: Option<String>,
    pub outcomes: Vec<PathOutcome>,
}

impl OpenResult {
    pub fn succeeded(&self) -> bool {
        self.error.is_none() && self.outcomes.iter().all(|outcome| outcome.error.is_none())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PagePhase {
    Loading,
    Ready,
    Unloaded,
}

#[derive(Debug, PartialEq, Eq)]
pub enum WakeAction {
    Show,
    Wait,
    Navigate,
}

pub struct OpenProtocol {
    pub phase: PagePhase,
    page_id: u64,
    next_request_id: u64,
    requests: VecDeque<OpenRequest>,
    claimed_by: Option<u64>,
    close_epoch: u64,
    close_ticket: Option<u64>,
    show_ticket: u64,
    pending_show: bool,
}

impl OpenProtocol {
    pub fn new() -> Self {
        Self {
            phase: PagePhase::Loading,
            page_id: 0,
            next_request_id: 0,
            requests: VecDeque::new(),
            claimed_by: None,
            close_epoch: 0,
            close_ticket: None,
            show_ticket: 0,
            pending_show: false,
        }
    }

    pub fn enqueue(&mut self, source: &str, paths: Vec<String>, error: Option<String>) -> u64 {
        self.next_request_id += 1;
        let id = self.next_request_id;
        self.requests.push_back(OpenRequest {
            id,
            source: source.into(),
            paths,
            error,
        });
        id
    }

    /// 页面开始导航或注册新上下文：废弃旧租约，但绝不清空未确认请求。
    pub fn loading(&mut self) {
        self.phase = PagePhase::Loading;
        self.page_id += 1;
        self.claimed_by = None;
    }

    pub fn begin_page(&mut self) -> PageRegistration {
        self.loading();
        PageRegistration {
            page_id: self.page_id,
            has_requests: !self.requests.is_empty(),
        }
    }

    pub fn ready(&mut self, page_id: u64) -> bool {
        if page_id != self.page_id || self.phase == PagePhase::Unloaded {
            return false;
        }
        self.phase = PagePhase::Ready;
        true
    }

    /// 同一页面重复领取返回同一队首；只有完成确认才能出队。
    pub fn claim(&mut self, page_id: u64) -> Option<OpenRequest> {
        if page_id != self.page_id || self.phase != PagePhase::Ready {
            return None;
        }
        let request = self.requests.front()?.clone();
        self.claimed_by = Some(page_id);
        Some(request)
    }

    pub fn complete(&mut self, page_id: u64, request_id: u64) -> Option<OpenRequest> {
        if page_id != self.page_id
            || self.claimed_by != Some(page_id)
            || self.requests.front().map(|request| request.id) != Some(request_id)
        {
            return None;
        }
        self.claimed_by = None;
        self.requests.pop_front()
    }

    /// 窗口显示和页面加载分离：就绪页面唤醒不导航，加载中不重复导航。
    pub fn wake(&mut self) -> (WakeAction, Option<u64>) {
        self.close_epoch += 1;
        self.close_ticket = None;
        let action = match self.phase {
            PagePhase::Ready => WakeAction::Show,
            PagePhase::Loading => WakeAction::Wait,
            PagePhase::Unloaded => {
                self.loading();
                WakeAction::Navigate
            }
        };
        let timeout = if action != WakeAction::Show && !self.pending_show {
            self.pending_show = true;
            self.show_ticket += 1;
            Some(self.show_ticket)
        } else {
            None
        };
        (action, timeout)
    }

    pub fn painted(&mut self, page_id: u64) -> bool {
        if page_id != self.page_id || self.phase != PagePhase::Ready {
            return false;
        }
        let show = self.pending_show;
        self.pending_show = false;
        show
    }

    pub fn show_timeout(&mut self, ticket: u64) -> bool {
        if ticket != self.show_ticket || !self.pending_show {
            return false;
        }
        self.pending_show = false;
        true
    }

    pub fn close(&mut self) -> u64 {
        self.close_epoch += 1;
        self.close_ticket = Some(self.close_epoch);
        self.pending_show = false;
        self.close_epoch
    }

    pub fn unload(&mut self, ticket: u64) -> bool {
        if self.close_ticket != Some(ticket) {
            return false;
        }
        self.close_ticket = None;
        self.loading();
        self.phase = PagePhase::Unloaded;
        true
    }
}

/// argv[0] 是 exe，cwd 独立传入。只支持位置参数及 --，未知开关明确失败而不猜测。
/// 不要求文件存在：不存在/权限不足应作为打开结果反馈，而不是筛选时悄悄丢弃。
pub fn parse_launch(argv: &[String], cwd: &Path) -> Result<Vec<String>, String> {
    let mut positional = false;
    let mut paths = Vec::new();
    for arg in argv.iter().skip(1) {
        if !positional && arg == "--" {
            positional = true;
            continue;
        }
        if !positional && arg.starts_with('-') {
            return Err(format!(
                "不支持的启动参数 {arg:?}；请直接传文件或目录路径，或用 -- 分隔"
            ));
        }
        if arg.is_empty() {
            return Err("启动参数包含空路径".into());
        }
        let path = Path::new(arg);
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            cwd.join(path)
        };
        paths.push(absolute.to_string_lossy().into_owned());
    }
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn queued() -> (OpenProtocol, u64) {
        let mut state = OpenProtocol::new();
        let id = state.enqueue("relaunch", vec!["a.md".into()], None);
        (state, id)
    }

    #[test]
    fn loading_cannot_claim() {
        let (mut state, _) = queued();
        let page = state.begin_page();
        assert!(page.has_requests);
        assert!(state.claim(page.page_id).is_none());
        assert!(state.ready(page.page_id));
        assert!(state.claim(page.page_id).is_some());
    }

    #[test]
    fn claim_is_not_destructive_and_completion_is() {
        let (mut state, id) = queued();
        let page = state.begin_page().page_id;
        state.ready(page);
        assert_eq!(state.claim(page).unwrap().id, id);
        assert_eq!(state.claim(page).unwrap().id, id);
        assert!(state.complete(page, id).is_some());
        assert!(state.claim(page).is_none());
        assert!(state.complete(page, id).is_none());
    }

    #[test]
    fn burst_is_fifo_and_not_a_single_overwritable_slot() {
        let (mut state, first) = queued();
        let second = state.enqueue("relaunch", vec!["b.md".into(), "c.md".into()], None);
        let page = state.begin_page().page_id;
        state.ready(page);
        assert_eq!(state.claim(page).unwrap().id, first);
        assert!(state.complete(page, second).is_none());
        state.complete(page, first);
        let request = state.claim(page).unwrap();
        assert_eq!(request.id, second);
        assert_eq!(request.paths, ["b.md", "c.md"]);
    }

    #[test]
    fn reload_releases_lease_not_request_and_rejects_stale_ack() {
        let (mut state, id) = queued();
        let old = state.begin_page().page_id;
        state.ready(old);
        state.claim(old);
        state.loading();
        assert!(state.complete(old, id).is_none());
        assert!(!state.ready(old));
        let new = state.begin_page().page_id;
        state.ready(new);
        assert_eq!(state.claim(new).unwrap().id, id);
        assert!(state.complete(new, id).is_some());
    }

    #[test]
    fn completion_requires_claim() {
        let (mut state, id) = queued();
        let page = state.begin_page().page_id;
        state.ready(page);
        assert!(state.complete(page, id).is_none());
    }

    #[test]
    fn wake_of_ready_page_does_not_reload() {
        let mut state = OpenProtocol::new();
        let page = state.begin_page().page_id;
        state.ready(page);
        assert_eq!(state.wake(), (WakeAction::Show, None));
        assert_eq!(state.phase, PagePhase::Ready);
    }

    #[test]
    fn unloaded_navigates_once_then_waits() {
        let mut state = OpenProtocol::new();
        let close = state.close();
        assert!(state.unload(close));
        assert_eq!(state.wake(), (WakeAction::Navigate, Some(1)));
        assert_eq!(state.wake(), (WakeAction::Wait, None));
    }

    #[test]
    fn tray_or_relaunch_wake_cancels_old_close() {
        let mut state = OpenProtocol::new();
        let old = state.close();
        state.wake();
        assert!(!state.unload(old));
        let new = state.close();
        assert!(!state.unload(old));
        assert!(state.unload(new));
    }

    #[test]
    fn unload_releases_inflight_request() {
        let (mut state, id) = queued();
        let page = state.begin_page().page_id;
        state.ready(page);
        state.claim(page);
        let ticket = state.close();
        state.unload(ticket);
        state.wake();
        let next = state.begin_page().page_id;
        state.ready(next);
        assert_eq!(state.claim(next).unwrap().id, id);
    }

    #[test]
    fn old_paint_and_timeout_cannot_reopen_closed_window() {
        let mut state = OpenProtocol::new();
        let page = state.begin_page().page_id;
        let (_, timeout) = state.wake();
        state.close();
        state.ready(page);
        assert!(!state.painted(page));
        assert!(!state.show_timeout(timeout.unwrap()));
    }

    #[test]
    fn painted_and_timeout_are_only_visibility_signals() {
        let (mut state, id) = queued();
        let page = state.begin_page().page_id;
        let (_, timeout) = state.wake();
        assert!(!state.painted(page));
        assert!(state.show_timeout(timeout.unwrap()));
        state.ready(page);
        assert_eq!(state.claim(page).unwrap().id, id);
    }

    #[test]
    fn parse_supports_multiple_paths_and_caller_cwd() {
        let cwd = std::env::current_dir().unwrap();
        let paths =
            parse_launch(&["app.exe".into(), "a b.md".into(), "docs".into()], &cwd).unwrap();
        assert_eq!(
            paths,
            [
                cwd.join("a b.md").to_string_lossy(),
                cwd.join("docs").to_string_lossy()
            ]
        );
    }

    #[test]
    fn parse_does_not_filter_missing_files() {
        let path = std::env::current_dir().unwrap().join("never-exists.md");
        assert_eq!(
            parse_launch(
                &["app".into(), path.to_string_lossy().into()],
                Path::new(".")
            ),
            Ok(vec![path.to_string_lossy().into()])
        );
    }

    #[test]
    fn unknown_options_fail_explicitly_and_dash_separator_works() {
        let cwd = std::env::current_dir().unwrap();
        assert!(parse_launch(&["app".into(), "--open".into(), "a.md".into()], &cwd).is_err());
        assert_eq!(
            parse_launch(&["app".into(), "--".into(), "-a.md".into()], &cwd).unwrap(),
            [cwd.join("-a.md").to_string_lossy()]
        );
        assert!(parse_launch(&["app".into(), "".into()], &cwd).is_err());
        assert!(parse_launch(&["app".into()], &cwd).unwrap().is_empty());
    }
}
