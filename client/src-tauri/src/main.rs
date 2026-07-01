use calamine::{open_workbook_auto, Data, Reader};
use directories::ProjectDirs;
use encoding_rs::GBK;
use lettre::message::{Mailbox, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::Tls;
use lettre::{Message, SmtpTransport, Transport};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::net::{IpAddr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

const EMAIL_SUBJECT: &str = "知识产权质押融资服务提示";
const SERVER_REQUEST_RETRIES: usize = 3;
const SERVER_REQUEST_RETRY_DELAY_SECS: u64 = 2;
const BATCH_CONTROL_POLL_INTERVAL_MS: u64 = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    server_url: String,
    api_token: String,
    smtp_host: String,
    smtp_port: u16,
    #[serde(default = "default_smtp_encryption")]
    smtp_encryption: String,
    #[serde(default)]
    smtp_secure: bool,
    smtp_username: String,
    smtp_password: String,
    from_email: String,
    from_name: String,
    branch_name: String,
    president_name: String,
    manager_name: String,
    manager_phone: String,
    send_interval_seconds: u64,
    #[serde(default)]
    send_limit_per_batch: u64,
    test_recipient: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server_url: "http://43.156.180.151:8080".to_string(),
            api_token: String::new(),
            smtp_host: String::new(),
            smtp_port: 465,
            smtp_encryption: "tls".to_string(),
            smtp_secure: true,
            smtp_username: String::new(),
            smtp_password: String::new(),
            from_email: String::new(),
            from_name: String::new(),
            branch_name: "交通银行北京中关村园区支行".to_string(),
            president_name: "杨诺".to_string(),
            manager_name: "路悦醍".to_string(),
            manager_phone: "19935493819".to_string(),
            send_interval_seconds: 3,
            send_limit_per_batch: 0,
            test_recipient: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecipientRow {
    id: String,
    row_number: usize,
    company_name: String,
    email: String,
    is_valid: bool,
    errors: Vec<String>,
    status: String,
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmailPreview {
    subject: String,
    text: String,
    html: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SendProgress {
    id: String,
    email: String,
    status: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppLog {
    id: String,
    time_ms: u64,
    level: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchSummary {
    total: usize,
    sent: usize,
    skipped: usize,
    failed: usize,
    limit_reached: bool,
    stopped: bool,
}

#[derive(Debug, Deserialize)]
struct CheckResponse {
    sent: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SentPayload<'a> {
    email: &'a str,
    company_name: &'a str,
    manager_name: &'a str,
    manager_phone: &'a str,
    branch_name: &'a str,
    president_name: &'a str,
    subject: &'a str,
}

#[derive(Clone)]
struct BatchControlHandle {
    inner: Arc<BatchControlState>,
}

struct BatchControlState {
    paused: AtomicBool,
    stopped: AtomicBool,
}

impl Default for BatchControlHandle {
    fn default() -> Self {
        Self {
            inner: Arc::new(BatchControlState {
                paused: AtomicBool::new(false),
                stopped: AtomicBool::new(false),
            }),
        }
    }
}

impl BatchControlHandle {
    fn reset(&self) {
        self.inner.paused.store(false, Ordering::SeqCst);
        self.inner.stopped.store(false, Ordering::SeqCst);
    }

    fn pause(&self) {
        self.inner.paused.store(true, Ordering::SeqCst);
    }

    fn resume(&self) {
        self.inner.paused.store(false, Ordering::SeqCst);
    }

    fn stop(&self) {
        self.inner.stopped.store(true, Ordering::SeqCst);
        self.inner.paused.store(false, Ordering::SeqCst);
    }

    fn is_paused(&self) -> bool {
        self.inner.paused.load(Ordering::SeqCst)
    }

    fn is_stopped(&self) -> bool {
        self.inner.stopped.load(Ordering::SeqCst)
    }

    fn wait_if_paused(&self, app: &AppHandle) -> bool {
        let mut logged_pause = false;
        while self.is_paused() && !self.is_stopped() {
            if !logged_pause {
                emit_log(app, "info", "批量任务已暂停，等待继续");
                logged_pause = true;
            }
            thread::sleep(Duration::from_millis(BATCH_CONTROL_POLL_INTERVAL_MS));
        }
        self.is_stopped()
    }

    fn sleep_with_control(&self, app: &AppHandle, seconds: u64) -> bool {
        let mut remaining = Duration::from_secs(seconds);
        while remaining > Duration::from_millis(0) {
            if self.wait_if_paused(app) || self.is_stopped() {
                return true;
            }

            let step = remaining.min(Duration::from_millis(BATCH_CONTROL_POLL_INTERVAL_MS));
            thread::sleep(step);
            remaining = remaining.saturating_sub(step);
        }

        self.is_stopped()
    }
}

fn config_path() -> Result<PathBuf, String> {
    let project_dirs = ProjectDirs::from("com", "EmailApp", "EmailApp")
        .ok_or_else(|| "无法确定本机配置目录".to_string())?;
    let config_dir = project_dirs.config_dir();
    fs::create_dir_all(config_dir).map_err(|error| format!("创建配置目录失败：{error}"))?;
    Ok(config_dir.join("config.json"))
}

#[tauri::command]
fn load_config() -> Result<AppConfig, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let content = fs::read_to_string(&path).map_err(|error| format!("读取配置失败：{error}"))?;
    let config = serde_json::from_str::<AppConfig>(&content)
        .map_err(|error| format!("配置文件格式错误：{error}"))?;
    Ok(config)
}

fn default_smtp_encryption() -> String {
    "tls".to_string()
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
    let path = config_path()?;
    let content = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("序列化配置失败：{error}"))?;
    fs::write(&path, content).map_err(|error| format!("写入配置失败：{error}"))?;
    Ok(())
}

#[tauri::command]
fn parse_recipient_file(path: String) -> Result<Vec<RecipientRow>, String> {
    let path_ref = Path::new(&path);
    if !path_ref.exists() {
        return Err("文件不存在".to_string());
    }

    let extension = path_ref
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let raw_rows = match extension.as_str() {
        "csv" => parse_csv(path_ref)?,
        "xlsx" | "xls" => parse_excel(path_ref)?,
        _ => return Err("仅支持 CSV、XLSX、XLS 文件".to_string()),
    };

    build_recipient_rows(raw_rows)
}

#[tauri::command]
fn render_email_preview(company_name: String, config: AppConfig) -> EmailPreview {
    render_email(&company_name, &config)
}

#[tauri::command]
async fn send_test_email(
    app: AppHandle,
    config: AppConfig,
    recipient: String,
    sample_company_name: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        emit_log(&app, "info", "开始发送测试邮件");
        if let Err(error) = validate_config(&config) {
            emit_log(&app, "error", &format!("配置校验失败：{error}"));
            return Err(error);
        }
        let email = normalize_email(&recipient);
        if !is_valid_email(&email) {
            emit_log(&app, "error", "测试收件邮箱无效");
            return Err("测试收件邮箱无效".to_string());
        }
        emit_log(
            &app,
            "info",
            &format!(
                "SMTP 目标：{}:{}，加密方式：{}，账号：{}，发件人：{}，测试收件人：{}",
                config.smtp_host,
                config.smtp_port,
                encryption_label(&effective_smtp_encryption(&config)),
                mask_account(&config.smtp_username),
                config.from_email,
                email
            ),
        );
        emit_smtp_resolution(&app, &config);
        match send_email(&config, &email, &sample_company_name, Some(&app)) {
            Ok(()) => {
                emit_log(&app, "info", "测试邮件发送成功");
                Ok(())
            }
            Err(error) => {
                emit_log(&app, "error", &error);
                Err(error)
            }
        }
    })
    .await
    .map_err(|error| format!("测试邮件任务异常：{error}"))?
}

#[tauri::command]
async fn start_batch_send(
    app: AppHandle,
    control: State<'_, BatchControlHandle>,
    config: AppConfig,
    recipients: Vec<RecipientRow>,
) -> Result<BatchSummary, String> {
    let control = control.inner().clone();
    control.reset();
    tauri::async_runtime::spawn_blocking(move || {
        validate_config(&config)?;
        let mut summary = BatchSummary {
            total: recipients.len(),
            sent: 0,
            skipped: 0,
            failed: 0,
            limit_reached: false,
            stopped: false,
        };
        let send_limit = config.send_limit_per_batch as usize;
        let mut smtp_sent_this_batch = 0usize;

        for (index, row) in recipients.iter().enumerate() {
            if control.wait_if_paused(&app) {
                summary.stopped = true;
                break;
            }

            if !row.is_valid {
                summary.failed += 1;
                emit_progress(&app, row, "failed", "导入数据无效");
                continue;
            }

            emit_progress(&app, row, "sending", "正在查询服务端去重记录");
            let already_sent = match check_server_sent(&config, &row.email) {
                Ok(already_sent) => already_sent,
                Err(error) => {
                    let message =
                        format!("服务端查询失败，已跳过该条并继续下一条：{error}");
                    summary.failed += 1;
                    emit_log(&app, "error", &format!("{}：{message}", row.email));
                    emit_progress(&app, row, "failed", &message);
                    continue;
                }
            };

            if already_sent {
                summary.skipped += 1;
                emit_progress(&app, row, "skipped", "服务端记录显示该邮箱已发送");
                continue;
            }

            emit_progress(&app, row, "sending", "正在通过 SMTP 发送");
            match send_email(&config, &row.email, &row.company_name, Some(&app)) {
                Ok(()) => {
                    smtp_sent_this_batch += 1;
                    emit_progress(&app, row, "sending", "邮件已发送，正在写入服务端记录");
                    match mark_server_sent(&config, row) {
                        Ok(()) => {
                            summary.sent += 1;
                            emit_progress(&app, row, "sent", "SMTP 成功，服务端已记录");
                        }
                        Err(error) => {
                            let message = format!(
                                "邮件已通过 SMTP 发送，但写入服务端失败，已跳过该条并继续下一条：{error}"
                            );
                            summary.failed += 1;
                            emit_log(&app, "error", &format!("{}：{message}", row.email));
                            emit_progress(&app, row, "failed", &message);
                        }
                    }
                }
                Err(error) => {
                    summary.failed += 1;
                    emit_log(&app, "error", &error);
                    emit_progress(&app, row, "failed", &error);
                }
            }

            if control.is_stopped() {
                summary.stopped = true;
                break;
            }

            if send_limit > 0 && smtp_sent_this_batch >= send_limit {
                if index + 1 < recipients.len() {
                    summary.limit_reached = true;
                    emit_log(
                        &app,
                        "info",
                        &format!(
                            "已达到本次发送上限 {send_limit} 封，剩余名单可再次点击发送继续处理"
                        ),
                    );
                }
                break;
            }

            if index + 1 < recipients.len() && config.send_interval_seconds > 0 {
                if control.sleep_with_control(&app, config.send_interval_seconds) {
                    summary.stopped = true;
                    break;
                }
            }
        }

        if summary.stopped {
            emit_log(
                &app,
                "warn",
                "批量任务已停止，剩余名单保持待发送，可再次点击开始继续",
            );
        }

        Ok(summary)
    })
    .await
    .map_err(|error| format!("批量发送任务异常：{error}"))?
}

#[tauri::command]
fn pause_batch_send(app: AppHandle, control: State<'_, BatchControlHandle>) -> Result<(), String> {
    control.inner().pause();
    emit_log(&app, "warn", "已请求暂停，当前正在处理的邮件完成后会暂停");
    Ok(())
}

#[tauri::command]
fn resume_batch_send(app: AppHandle, control: State<'_, BatchControlHandle>) -> Result<(), String> {
    control.inner().resume();
    emit_log(&app, "info", "批量任务已继续");
    Ok(())
}

#[tauri::command]
fn stop_batch_send(app: AppHandle, control: State<'_, BatchControlHandle>) -> Result<(), String> {
    control.inner().stop();
    emit_log(&app, "warn", "已请求停止，当前正在处理的邮件完成后会停止");
    Ok(())
}

#[tauri::command]
async fn import_sent_records(
    app: AppHandle,
    config: AppConfig,
    recipients: Vec<RecipientRow>,
) -> Result<BatchSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_sent_import_config(&config)?;
        let mut summary = BatchSummary {
            total: recipients.len(),
            sent: 0,
            skipped: 0,
            failed: 0,
            limit_reached: false,
            stopped: false,
        };

        for row in recipients.iter() {
            if !row.is_valid {
                summary.failed += 1;
                emit_progress(&app, row, "failed", "导入数据无效");
                continue;
            }

            emit_progress(&app, row, "sending", "正在查询服务端已发记录");
            let already_sent = match check_server_sent(&config, &row.email) {
                Ok(already_sent) => already_sent,
                Err(error) => {
                    let message = format!("服务端查询失败，已跳过该条并继续下一条：{error}");
                    summary.failed += 1;
                    emit_log(&app, "error", &format!("{}：{message}", row.email));
                    emit_progress(&app, row, "failed", &message);
                    continue;
                }
            };

            if already_sent {
                summary.skipped += 1;
                emit_progress(&app, row, "skipped", "服务器中已存在该邮箱");
                continue;
            }

            emit_progress(&app, row, "sending", "正在写入服务器已发名单");
            match mark_server_sent(&config, row) {
                Ok(()) => {
                    summary.sent += 1;
                    emit_progress(&app, row, "sent", "已导入服务器已发名单");
                }
                Err(error) => {
                    emit_log(
                        &app,
                        "error",
                        &format!("{}：写入服务器已发名单失败：{error}", row.email),
                    );
                    summary.failed += 1;
                    emit_progress(&app, row, "failed", &error);
                }
            }
        }

        Ok(summary)
    })
    .await
    .map_err(|error| format!("已发名单导入任务异常：{error}"))?
}

fn parse_csv(path: &Path) -> Result<Vec<Vec<String>>, String> {
    let bytes = fs::read(path).map_err(|error| format!("读取 CSV 失败：{error}"))?;
    let content = String::from_utf8(bytes.clone()).unwrap_or_else(|_| {
        let (decoded, _, _) = GBK.decode(&bytes);
        decoded.into_owned()
    });
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(content.as_bytes());
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|error| format!("解析 CSV 失败：{error}"))?;
        rows.push(record.iter().map(clean_cell).collect());
    }
    Ok(rows)
}

fn parse_excel(path: &Path) -> Result<Vec<Vec<String>>, String> {
    let mut workbook =
        open_workbook_auto(path).map_err(|error| format!("打开 Excel 失败：{error}"))?;
    let sheet_name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| "Excel 文件没有工作表".to_string())?;
    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|error| format!("读取工作表失败：{error}"))?;

    let rows = range
        .rows()
        .map(|row| row.iter().map(cell_to_string).collect::<Vec<_>>())
        .collect();
    Ok(rows)
}

fn build_recipient_rows(raw_rows: Vec<Vec<String>>) -> Result<Vec<RecipientRow>, String> {
    let meaningful_rows: Vec<Vec<String>> = raw_rows
        .into_iter()
        .filter(|row| row.iter().any(|cell| !cell.trim().is_empty()))
        .collect();

    if meaningful_rows.is_empty() {
        return Err("名单为空".to_string());
    }

    let (company_index, email_index, start_index) = detect_columns(&meaningful_rows)?;
    let mut seen = HashSet::new();
    let mut rows = Vec::new();

    for (offset, row) in meaningful_rows.iter().enumerate().skip(start_index) {
        let row_number = offset + 1;
        let company_name = row
            .get(company_index)
            .map(String::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let email = normalize_email(row.get(email_index).map(String::as_str).unwrap_or(""));
        let mut errors = Vec::new();

        if company_name.is_empty() {
            errors.push("企业名为空".to_string());
        }
        if email.is_empty() {
            errors.push("邮箱为空".to_string());
        } else if !is_valid_email(&email) {
            errors.push("邮箱格式无效".to_string());
        } else if !seen.insert(email.clone()) {
            errors.push("邮箱在文件中重复".to_string());
        }

        let is_valid = errors.is_empty();
        rows.push(RecipientRow {
            id: format!("row-{row_number}"),
            row_number,
            company_name,
            email,
            is_valid,
            errors,
            status: if is_valid { "pending" } else { "failed" }.to_string(),
            message: None,
        });
    }

    if rows.is_empty() {
        return Err("没有可解析的数据行".to_string());
    }

    Ok(rows)
}

fn detect_columns(rows: &[Vec<String>]) -> Result<(usize, usize, usize), String> {
    let header = rows.first().ok_or_else(|| "名单为空".to_string())?;
    let company_headers = [
        "企业名",
        "企业名称",
        "公司名",
        "公司名称",
        "客户名称",
        "company",
        "companyname",
        "company name",
        "name",
    ];
    let email_headers = ["邮箱", "企业邮箱", "邮件", "email", "e-mail", "mail"];

    let mut header_map = HashMap::new();
    for (index, cell) in header.iter().enumerate() {
        header_map.insert(normalize_header(cell), index);
    }

    let company_index = company_headers
        .iter()
        .find_map(|candidate| header_map.get(&normalize_header(candidate)).copied());
    let email_index = email_headers
        .iter()
        .find_map(|candidate| header_map.get(&normalize_header(candidate)).copied());

    match (company_index, email_index) {
        (Some(company), Some(email)) if company != email => Ok((company, email, 1)),
        _ if header.len() >= 2 => Ok((0, 1, 0)),
        _ => Err("名单至少需要两列：企业名、邮箱".to_string()),
    }
}

fn normalize_header(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .replace(' ', "")
        .replace('_', "")
        .replace('-', "")
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(value) => clean_cell(value),
        Data::Float(value) => {
            if value.fract() == 0.0 {
                format!("{value:.0}")
            } else {
                value.to_string()
            }
        }
        Data::Int(value) => value.to_string(),
        Data::Bool(value) => value.to_string(),
        other => other.to_string(),
    }
}

fn clean_cell(value: &str) -> String {
    value.trim().trim_matches('\u{feff}').trim().to_string()
}

fn normalize_email(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn is_valid_email(value: &str) -> bool {
    let value = normalize_email(value);
    let parts: Vec<&str> = value.split('@').collect();
    parts.len() == 2 && !parts[0].is_empty() && parts[1].contains('.') && !parts[1].ends_with('.')
}

fn validate_config(config: &AppConfig) -> Result<(), String> {
    validate_sent_import_config(config)?;
    if config.smtp_host.trim().is_empty() {
        return Err("SMTP 服务器不能为空".to_string());
    }
    if config.smtp_username.trim().is_empty() {
        return Err("SMTP 账号不能为空".to_string());
    }
    if config.smtp_password.trim().is_empty() {
        return Err("SMTP 密码不能为空".to_string());
    }
    if !matches!(
        effective_smtp_encryption(config).as_str(),
        "tls" | "starttls" | "none"
    ) {
        return Err("SMTP 加密方式无效".to_string());
    }
    if !is_valid_email(&config.from_email) {
        return Err("发件人邮箱无效".to_string());
    }
    Ok(())
}

fn validate_sent_import_config(config: &AppConfig) -> Result<(), String> {
    if config.server_url.trim().is_empty() {
        return Err("服务端地址不能为空".to_string());
    }
    if config.api_token.trim().is_empty() {
        return Err("API Token 不能为空".to_string());
    }
    if config.branch_name.trim().is_empty() {
        return Err("支行名不能为空".to_string());
    }
    if config.president_name.trim().is_empty() {
        return Err("行长名不能为空".to_string());
    }
    if config.manager_name.trim().is_empty() {
        return Err("客户经理姓名不能为空".to_string());
    }
    if config.manager_phone.trim().is_empty() {
        return Err("客户经理电话不能为空".to_string());
    }
    Ok(())
}

fn render_email(company_name: &str, config: &AppConfig) -> EmailPreview {
    let company = fallback(company_name, "北京创谱科技有限公司");
    let branch = fallback(&config.branch_name, "交通银行北京中关村园区支行");
    let president = fallback(&config.president_name, "杨诺");
    let manager = fallback(&config.manager_name, "路悦醍");
    let phone = fallback(&config.manager_phone, "19935493819");

    let lines = vec![
        format!("{company}，您好："),
        format!("我方为{branch}。"),
        "近期国家知识产权局持续推动知识产权质押融资相关工作，我行也在为有专利、商标、软著等知识产权资产的企业提供配套融资服务，这次主要是向贵司做一个政策和融资服务提示。".to_string(),
        "我们了解到贵司整体资质较好。如贵司有相关知识产权资产，可尝试通过知识产权质押方式补充经营资金，我行可以配合推进知识产权质押融资相关手续，包括质押登记、授信申报等；符合条件的情况下，融资利率可做到1.2%左右，具体以企业资质、知识产权情况及审批结果为准。".to_string(),
        "此外，我行还有创业担保贷产品。该产品有人社部门相关补贴支持，符合条件的企业，担保费不向企业收取，利率同样可做到1.2%左右，后续可结合贵司实际情况一并匹配。".to_string(),
        format!("这类事项建议转给融资或财务相关同事推进。有需要可以随时联系我行客户经理{manager}{phone}。如贵司需进一步了解相关政策及资料，可添加我的微信（与上述手机号码一致），我将及时发送相关资料供参考。"),
        format!("{branch}行长 {president}"),
        format!("对公客户经理：{manager}{phone}"),
    ];

    let company_html = html_escape::encode_text(company);
    let branch_html = html_escape::encode_text(branch);
    let president_html = html_escape::encode_text(president);
    let manager_html = html_escape::encode_text(manager);
    let phone_html = html_escape::encode_text(phone);
    let html = format!(
        r#"<div style="margin:0;padding:0;background:#ffffff;color:#1f2933;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',Arial,sans-serif;font-size:15px;line-height:1.9;">
  <div style="max-width:680px;margin:0;padding:0;">
    <p style="margin:0 0 16px;">{company_html}，您好：</p>
    <p style="margin:0 0 16px;">我方为{branch_html}。</p>
    <p style="margin:0 0 16px;">近期国家知识产权局持续推动知识产权质押融资相关工作，我行也在为有专利、商标、软著等知识产权资产的企业提供配套融资服务，这次主要是向贵司做一个政策和融资服务提示。</p>
    <p style="margin:0 0 16px;">我们了解到贵司整体资质较好。如贵司有相关知识产权资产，可尝试通过知识产权质押方式补充经营资金，我行可以配合推进知识产权质押融资相关手续，包括质押登记、授信申报等；符合条件的情况下，<strong style="color:#d92d20;">融资利率可做到1.2%左右</strong>，具体以企业资质、知识产权情况及审批结果为准。</p>
    <p style="margin:0 0 16px;">此外，我行还有创业担保贷产品。该产品有人社部门相关补贴支持，符合条件的企业，担保费不向企业收取，<strong style="color:#d92d20;">利率同样可做到1.2%左右</strong>，后续可结合贵司实际情况一并匹配。</p>
    <p style="margin:0 0 16px;">这类事项建议转给融资或财务相关同事推进。有需要可以随时联系我行客户经理{manager_html}{phone_html}。如贵司需进一步了解相关政策及资料，可添加我的微信（与上述手机号码一致），我将及时发送相关资料供参考。</p>
    <div style="margin-top:28px;line-height:1.8;">
      <div style="margin:0 0 4px;">{branch_html}行长 {president_html}</div>
      <div>对公客户经理：{manager_html}{phone_html}</div>
    </div>
  </div>
</div>"#
    );

    EmailPreview {
        subject: EMAIL_SUBJECT.to_string(),
        text: lines.join("\n\n"),
        html,
    }
}

fn fallback<'a>(value: &'a str, default_value: &'a str) -> &'a str {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        default_value
    } else {
        trimmed
    }
}

fn send_email(
    config: &AppConfig,
    recipient: &str,
    company_name: &str,
    app: Option<&AppHandle>,
) -> Result<(), String> {
    if let Some(app) = app {
        emit_log(app, "info", "正在渲染邮件模板");
    }
    let preview = render_email(company_name, config);
    let from = mailbox(&config.from_email, Some(&config.from_name))?;
    let to = mailbox(recipient, None)?;

    if let Some(app) = app {
        emit_log(app, "info", "正在构建 MIME 邮件内容");
    }
    let message = Message::builder()
        .from(from)
        .to(to)
        .subject(preview.subject)
        .multipart(
            MultiPart::alternative()
                .singlepart(SinglePart::plain(preview.text))
                .singlepart(SinglePart::html(preview.html)),
        )
        .map_err(|error| format!("构建邮件失败：{}", detailed_error(&error)))?;

    if let Some(app) = app {
        emit_log(
            app,
            "info",
            &format!(
                "正在初始化 SMTP 传输：{}:{}，加密方式：{}",
                config.smtp_host,
                config.smtp_port,
                encryption_label(&effective_smtp_encryption(config))
            ),
        );
    }
    let credentials = Credentials::new(config.smtp_username.clone(), config.smtp_password.clone());
    let transport = match effective_smtp_encryption(config).as_str() {
        "tls" => SmtpTransport::relay(&config.smtp_host)
            .map_err(|error| format!("SMTP SSL/TLS 配置失败：{}", detailed_error(&error)))?
            .port(config.smtp_port)
            .credentials(credentials)
            .build(),
        "starttls" => SmtpTransport::starttls_relay(&config.smtp_host)
            .map_err(|error| format!("SMTP STARTTLS 配置失败：{}", detailed_error(&error)))?
            .port(config.smtp_port)
            .credentials(credentials)
            .build(),
        "none" => SmtpTransport::builder_dangerous(&config.smtp_host)
            .port(config.smtp_port)
            .tls(Tls::None)
            .credentials(credentials)
            .build(),
        _ => return Err("SMTP 加密方式无效".to_string()),
    };

    if let Some(app) = app {
        emit_log(app, "info", "正在连接 SMTP 并发送邮件");
    }
    transport
        .send(&message)
        .map_err(|error| format!("SMTP 发送失败：{}", detailed_error(&error)))?;
    Ok(())
}

fn effective_smtp_encryption(config: &AppConfig) -> String {
    let value = config.smtp_encryption.trim().to_ascii_lowercase();
    if matches!(value.as_str(), "tls" | "starttls" | "none") {
        return value;
    }
    if config.smtp_secure {
        "tls".to_string()
    } else {
        "none".to_string()
    }
}

fn mailbox(email: &str, name: Option<&str>) -> Result<Mailbox, String> {
    let email = normalize_email(email);
    if !is_valid_email(&email) {
        return Err(format!("邮箱地址无效：{email}"));
    }
    match name.map(str::trim).filter(|value| !value.is_empty()) {
        Some(name) => format!("{name} <{email}>")
            .parse()
            .map_err(|error| format!("发件人地址格式错误：{error}")),
        None => email
            .parse()
            .map_err(|error| format!("收件人地址格式错误：{error}")),
    }
}

fn retry_server_request<T, F>(operation: &str, mut request: F) -> Result<T, String>
where
    F: FnMut() -> Result<T, String>,
{
    let mut last_error = String::new();

    for attempt in 0..=SERVER_REQUEST_RETRIES {
        match request() {
            Ok(value) => return Ok(value),
            Err(error) => {
                last_error = error;
                if attempt < SERVER_REQUEST_RETRIES {
                    thread::sleep(Duration::from_secs(SERVER_REQUEST_RETRY_DELAY_SECS));
                }
            }
        }
    }

    Err(format!(
        "{operation} 已重试 {SERVER_REQUEST_RETRIES} 次仍失败：{last_error}"
    ))
}

fn check_server_sent(config: &AppConfig, email: &str) -> Result<bool, String> {
    retry_server_request("请求 /api/check", || {
        let client = http_client()?;
        let response = client
            .post(api_url(config, "/api/check"))
            .bearer_auth(config.api_token.trim())
            .json(&serde_json::json!({ "email": normalize_email(email) }))
            .send()
            .map_err(|error| format!("请求 /api/check 失败：{error}"))?;

        if !response.status().is_success() {
            return Err(format!("服务端返回 HTTP {}", response.status()));
        }

        let payload = response
            .json::<CheckResponse>()
            .map_err(|error| format!("解析 /api/check 响应失败：{error}"))?;
        Ok(payload.sent)
    })
}

fn mark_server_sent(config: &AppConfig, row: &RecipientRow) -> Result<(), String> {
    retry_server_request("请求 /api/sent", || {
        let client = http_client()?;
        let payload = SentPayload {
            email: &row.email,
            company_name: &row.company_name,
            manager_name: &config.manager_name,
            manager_phone: &config.manager_phone,
            branch_name: &config.branch_name,
            president_name: &config.president_name,
            subject: EMAIL_SUBJECT,
        };

        let response = client
            .post(api_url(config, "/api/sent"))
            .bearer_auth(config.api_token.trim())
            .json(&payload)
            .send()
            .map_err(|error| format!("请求 /api/sent 失败：{error}"))?;

        if !response.status().is_success() {
            return Err(format!("服务端返回 HTTP {}", response.status()));
        }

        Ok(())
    })
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败：{error}"))
}

fn api_url(config: &AppConfig, path: &str) -> String {
    format!("{}{}", config.server_url.trim().trim_end_matches('/'), path)
}

fn emit_progress(app: &AppHandle, row: &RecipientRow, status: &str, message: &str) {
    let _ = app.emit(
        "send-progress",
        SendProgress {
            id: row.id.clone(),
            email: row.email.clone(),
            status: status.to_string(),
            message: message.to_string(),
        },
    );
}

fn emit_log(app: &AppHandle, level: &str, message: &str) {
    let time_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let _ = app.emit(
        "app-log",
        AppLog {
            id: format!("log-{time_ms}-{}", message.len()),
            time_ms,
            level: level.to_string(),
            message: message.to_string(),
        },
    );
}

fn emit_smtp_resolution(app: &AppHandle, config: &AppConfig) {
    let target = format!("{}:{}", config.smtp_host.trim(), config.smtp_port);
    match target.to_socket_addrs() {
        Ok(addrs) => {
            let mut ips = Vec::new();
            let mut has_fake_ip = false;
            for addr in addrs {
                let ip = addr.ip();
                if !ips.contains(&ip) {
                    if is_fake_ip(ip) {
                        has_fake_ip = true;
                    }
                    ips.push(ip);
                }
            }

            if ips.is_empty() {
                emit_log(app, "warn", &format!("DNS 解析没有返回地址：{target}"));
                return;
            }

            let ip_list = ips
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(", ");
            emit_log(
                app,
                "info",
                &format!("DNS 解析：{} -> {}", config.smtp_host.trim(), ip_list),
            );

            if has_fake_ip {
                emit_log(
                    app,
                    "warn",
                    "DNS 解析命中 198.18.0.0/15 Fake-IP/测试保留网段。若正在使用 Clash、Surge、代理或 VPN，请将 smtp.qq.com 设置为 DIRECT/真实 DNS，或临时关闭代理后重试。",
                );
            }
        }
        Err(error) => {
            emit_log(app, "warn", &format!("DNS 解析失败：{target}，{error}"));
        }
    }
}

fn is_fake_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => {
            let octets = value.octets();
            octets[0] == 198 && (octets[1] == 18 || octets[1] == 19)
        }
        IpAddr::V6(_) => false,
    }
}

fn detailed_error(error: &(dyn std::error::Error + 'static)) -> String {
    let mut parts = vec![error.to_string()];
    let mut current = error.source();
    while let Some(source) = current {
        parts.push(format!("caused by: {source}"));
        current = source.source();
    }
    parts.push(format!("debug: {error:?}"));
    parts.join(" | ")
}

fn encryption_label(value: &str) -> &'static str {
    match value {
        "tls" => "SSL/TLS",
        "starttls" => "STARTTLS",
        "none" => "不加密",
        _ => "未知",
    }
}

fn mask_account(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= 4 {
        return "***".to_string();
    }
    let keep = trimmed.chars().take(3).collect::<String>();
    format!("{keep}***")
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(BatchControlHandle::default())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            parse_recipient_file,
            render_email_preview,
            send_test_email,
            start_batch_send,
            pause_batch_send,
            resume_batch_send,
            stop_batch_send,
            import_sent_records
        ])
        .run(tauri::generate_context!())
        .expect("error while running EmailApp");
}
