use calamine::{open_workbook_auto, DataType, Reader};
use directories::ProjectDirs;
use encoding_rs::GBK;
use lettre::message::{Mailbox, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const EMAIL_SUBJECT: &str = "知识产权贴息政策提示";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    server_url: String,
    api_token: String,
    smtp_host: String,
    smtp_port: u16,
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
    test_recipient: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server_url: "http://43.156.180.151:8080".to_string(),
            api_token: String::new(),
            smtp_host: String::new(),
            smtp_port: 465,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmailPreview {
    subject: String,
    text: String,
    html: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SendProgress {
    id: String,
    email: String,
    status: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchSummary {
    total: usize,
    sent: usize,
    skipped: usize,
    failed: usize,
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
    config: AppConfig,
    recipient: String,
    sample_company_name: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_config(&config)?;
        let email = normalize_email(&recipient);
        if !is_valid_email(&email) {
            return Err("测试收件邮箱无效".to_string());
        }
        send_email(&config, &email, &sample_company_name)
    })
    .await
    .map_err(|error| format!("测试邮件任务异常：{error}"))?
}

#[tauri::command]
async fn start_batch_send(
    app: AppHandle,
    config: AppConfig,
    recipients: Vec<RecipientRow>,
) -> Result<BatchSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_config(&config)?;
        let mut summary = BatchSummary {
            total: recipients.len(),
            sent: 0,
            skipped: 0,
            failed: 0,
        };

        for (index, row) in recipients.iter().enumerate() {
            if !row.is_valid {
                summary.failed += 1;
                emit_progress(&app, row, "failed", "导入数据无效");
                continue;
            }

            emit_progress(&app, row, "sending", "正在查询服务端去重记录");
            let already_sent = check_server_sent(&config, &row.email)
                .map_err(|error| format!("服务端查询失败，已暂停任务：{error}"))?;

            if already_sent {
                summary.skipped += 1;
                emit_progress(&app, row, "skipped", "服务端记录显示该邮箱已发送");
                continue;
            }

            emit_progress(&app, row, "sending", "正在通过 SMTP 发送");
            match send_email(&config, &row.email, &row.company_name) {
                Ok(()) => {
                    emit_progress(&app, row, "sending", "邮件已发送，正在写入服务端记录");
                    mark_server_sent(&config, row).map_err(|error| {
                        format!(
                            "{} 的邮件已发送，但写入服务端失败，已暂停任务：{error}",
                            row.email
                        )
                    })?;
                    summary.sent += 1;
                    emit_progress(&app, row, "sent", "SMTP 成功，服务端已记录");
                }
                Err(error) => {
                    summary.failed += 1;
                    emit_progress(&app, row, "failed", &error);
                }
            }

            if index + 1 < recipients.len() && config.send_interval_seconds > 0 {
                thread::sleep(Duration::from_secs(config.send_interval_seconds));
            }
        }

        Ok(summary)
    })
    .await
    .map_err(|error| format!("批量发送任务异常：{error}"))?
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
        .ok_or_else(|| "读取第一个工作表失败".to_string())?
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

fn cell_to_string(cell: &DataType) -> String {
    match cell {
        DataType::Empty => String::new(),
        DataType::String(value) => clean_cell(value),
        DataType::Float(value) => {
            if value.fract() == 0.0 {
                format!("{value:.0}")
            } else {
                value.to_string()
            }
        }
        DataType::Int(value) => value.to_string(),
        DataType::Bool(value) => value.to_string(),
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
    if config.server_url.trim().is_empty() {
        return Err("服务端地址不能为空".to_string());
    }
    if config.api_token.trim().is_empty() {
        return Err("API Token 不能为空".to_string());
    }
    if config.smtp_host.trim().is_empty() {
        return Err("SMTP 服务器不能为空".to_string());
    }
    if config.smtp_username.trim().is_empty() {
        return Err("SMTP 账号不能为空".to_string());
    }
    if config.smtp_password.trim().is_empty() {
        return Err("SMTP 密码不能为空".to_string());
    }
    if !is_valid_email(&config.from_email) {
        return Err("发件人邮箱无效".to_string());
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
    "近期国家知识产权局正在推动知识产权质押融资相关政策，这次主要是向贵司做一个政策宣导。".to_string(),
    "我们了解到贵司整体资质较好。知识产权质押贴息贷款通过贴息后利率可以做到1.2%，低于定期存款。如果贵司有专利、商标、软著等知识产权资产，可以补贴利息50%，最高不超过30万元。".to_string(),
    format!("这类事项建议转给融资或财务相关同事推进。有需要可以随时联系我行客户经理{manager}{phone}。"),
    format!("{branch}行长 {president}"),
    format!("对公客户经理：{manager}{phone}"),
  ];

    let html = lines
        .iter()
        .map(|line| html_escape::encode_text(line).replace("1.2%", "<strong>1.2%</strong>"))
        .collect::<Vec<_>>()
        .join("<br />");

    EmailPreview {
        subject: EMAIL_SUBJECT.to_string(),
        text: lines.join("\n"),
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

fn send_email(config: &AppConfig, recipient: &str, company_name: &str) -> Result<(), String> {
    let preview = render_email(company_name, config);
    let from = mailbox(&config.from_email, Some(&config.from_name))?;
    let to = mailbox(recipient, None)?;

    let message = Message::builder()
        .from(from)
        .to(to)
        .subject(preview.subject)
        .multipart(
            MultiPart::alternative()
                .singlepart(SinglePart::plain(preview.text))
                .singlepart(SinglePart::html(preview.html)),
        )
        .map_err(|error| format!("构建邮件失败：{error}"))?;

    let credentials = Credentials::new(config.smtp_username.clone(), config.smtp_password.clone());
    let transport = if config.smtp_secure {
        SmtpTransport::relay(&config.smtp_host)
            .map_err(|error| format!("SMTP TLS 配置失败：{error}"))?
            .port(config.smtp_port)
            .credentials(credentials)
            .build()
    } else {
        SmtpTransport::builder_dangerous(&config.smtp_host)
            .port(config.smtp_port)
            .credentials(credentials)
            .build()
    };

    transport
        .send(&message)
        .map_err(|error| format!("SMTP 发送失败：{error}"))?;
    Ok(())
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

fn check_server_sent(config: &AppConfig, email: &str) -> Result<bool, String> {
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
}

fn mark_server_sent(config: &AppConfig, row: &RecipientRow) -> Result<(), String> {
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            parse_recipient_file,
            render_email_preview,
            send_test_email,
            start_batch_send
        ])
        .run(tauri::generate_context!())
        .expect("error while running EmailApp");
}
