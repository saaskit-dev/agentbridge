use std::path::Path;

fn main() {
  let updater_config = Path::new("tauri.updater.conf.json");
  println!("cargo:rerun-if-changed={}", updater_config.display());

  let updater_enabled = updater_config.exists();
  println!(
    "cargo:rustc-env=DESKTOP_UPDATER_ENABLED={}",
    if updater_enabled { "1" } else { "0" }
  );

  tauri_build::build()
}
