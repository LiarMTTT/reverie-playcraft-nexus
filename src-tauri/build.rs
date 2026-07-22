use std::env;

fn require_release_value(name: &str) {
    println!("cargo:rerun-if-env-changed={name}");
    let value = env::var(name).unwrap_or_default();
    if value.trim().is_empty() {
        panic!("signed release build requires {name}");
    }
}

fn main() {
    if env::var_os("CARGO_FEATURE_RELEASE_UPDATER").is_some() {
        require_release_value("RPN_UPDATER_PUBLIC_KEY");
        require_release_value("RPN_UPDATER_ENDPOINT");
        require_release_value("TAURI_SIGNING_PRIVATE_KEY");

        let endpoint = env::var("RPN_UPDATER_ENDPOINT").unwrap_or_default();
        if !endpoint.trim().starts_with("https://") {
            panic!("RPN_UPDATER_ENDPOINT must use HTTPS");
        }
    }

    const COMMANDS: &[&str] = &[
        "desktop_get_state",
        "desktop_open_rpn",
        "desktop_open_st",
        "desktop_reload_active",
        "desktop_open_devtools",
        "desktop_set_st_url",
        "desktop_check_update",
        "desktop_download_update",
        "desktop_install_update",
        "desktop_rpn_flush_complete",
    ];
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    tauri_build::try_build(attributes).expect("failed to build RPN desktop shell");
}
