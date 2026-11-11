// Udozo POS for Windows. For now the window shows pos.udozo.com's own pages: the bundled start page (start/index.html)
// waits for the internet, then opens the till. Bundled screens, offline selling, printing and the cash drawer come with
// milestone 9 (docs/UDOZO_POS_PLAN.md). The pages it shows get no access to this app's commands: there are no
// capabilities, so nothing on pos.udozo.com can call into Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// The sites the window may show: Udozo POS, and udozo.com where owners sign in. Every other address opens in the
/// person's browser.
const ALLOWED_HOSTS: [&str; 3] = ["pos.udozo.com", "udozo.com", "www.udozo.com"];

/// Whether an address stays in the window: the bundled start page, or an https page of an allowed site.
fn stays_in_app(url: &Url) -> bool {
    match url.scheme() {
        "https" => url.host_str().is_some_and(|host| ALLOWED_HOSTS.contains(&host)),
        "tauri" => true,
        "http" => url.host_str() == Some("tauri.localhost"),
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

fn main() {
    tauri::Builder::default()
        // First, so a second copy only brings this one forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Udozo POS")
                .inner_size(1280.0, 800.0)
                .min_inner_size(960.0, 600.0)
                .maximized(true)
                .on_navigation(move |url| {
                    if stays_in_app(url) {
                        return true;
                    }
                    if matches!(url.scheme(), "https" | "http" | "mailto" | "tel") {
                        let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                    }
                    false
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Udozo POS could not start");
}
