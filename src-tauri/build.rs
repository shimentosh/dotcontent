fn main() {
    /*
     * Both addresses are compiled in, so Cargo has to know that changing
     * either one invalidates the build.
     *
     * `option_env!` in src/settings.rs reads the environment of the
     * *compiler*, and a rebuild that Cargo thinks is unnecessary is a rebuild
     * it does not do: without these lines, exporting a new address and running
     * `npm run desktop:installer` again hands out an installer carrying
     * yesterday's server, with nothing on screen or in the log to say so. The
     * whole point of baking them in is that nobody downstream checks them,
     * which is exactly why they must not be able to go stale here.
     *
     * Two lines rather than one because they are two independent values —
     * `docs/DEPLOYING.md` puts the console on APP_HOST and the API on
     * API_HOST, and moving only the second is an ordinary thing to do. A
     * single line would leave that build carrying the old API and looking
     * fine.
     */
    println!("cargo:rerun-if-env-changed=CONTENTOS_CONSOLE_URL");
    println!("cargo:rerun-if-env-changed=CONTENTOS_API_URL");

    // Reads tauri.conf.json, resolves capabilities/, and — the part that
    // actually bites — compiles icons/icon.ico into the Windows executable's
    // resources. Without that file this build fails outright rather than
    // producing an app with a blank icon in the taskbar.
    tauri_build::build()
}
