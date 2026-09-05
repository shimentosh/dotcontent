fn main() {
    // Reads tauri.conf.json, resolves capabilities/, and — the part that
    // actually bites — compiles icons/icon.ico into the Windows executable's
    // resources. Without that file this build fails outright rather than
    // producing an app with a blank icon in the taskbar.
    tauri_build::build()
}
