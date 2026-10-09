//! Updating the app itself — wired, and switched off until somebody points it
//! at a server.
//!
//! Everything a teammate sees in dotcontent is served by the console, so the
//! usual reason to update a desktop app does not apply: a template change or a
//! bug fix in the UI reaches every machine the moment the server is deployed.
//! What is in the installer is the shell around it — the worker, the runtime
//! it spawns, the tray, this file — and that changes rarely and matters when
//! it does. A machine running last quarter's worker against this quarter's
//! server is exactly the failure nobody notices until a job behaves oddly on
//! one desktop.
//!
//! **What is here and what is not.** The plugin is registered, the check runs,
//! and the result lands in the tray where a background app should report. What
//! is missing is not code: it is a URL to ask and a key to verify with, and
//! both are entries in `tauri.conf.json`:
//!
//! ```json
//! "plugins": { "updater": {
//!   "endpoints": ["https://…/latest.json"],
//!   "pubkey": "…the public half of the signing key…"
//! } }
//! ```
//!
//! Nothing here can be honestly finished without them, and neither one can be
//! invented in a repository. A key pair would have to have its private half
//! somewhere, and the only somewhere available to a commit is the commit — at
//! which point anybody who has cloned this can sign an "update" that every
//! installed copy will accept and run. So the endpoint stays empty, the menu
//! item below does not appear, and `docs/WORKER.md` says exactly what a person
//! has to add. **This path has never been exercised end to end**, for the
//! plain reason that there is no endpoint to exercise it against.
//!
//! What the check would do is deliberately small: ask, and if there is
//! something newer, download it, stop the worker, and hand over to the
//! installer. No silent updates — a machine that is halfway through writing a
//! section should not restart itself because a release happened.

use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::tray;
use crate::worker::Worker;

/// Whether this build was given somewhere to look for updates.
///
/// Read from the config at run time rather than decided at compile time, so
/// that adding an endpoint really is a configuration change: nothing in this
/// file has to be touched to turn updating on. Without one the tray item is
/// absent altogether, because a button that can only ever answer "this was
/// built without an update server" is a button that teaches people the menu
/// lies.
pub fn configured(app: &AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("endpoints"))
        .and_then(|endpoints| endpoints.as_array())
        .is_some_and(|endpoints| !endpoints.is_empty())
}

/// Ask, and install whatever comes back.
///
/// Returns immediately; everything after it happens on the async runtime and
/// reports through the tray, because the window is usually closed — that is
/// the whole point of the tray — and an update that only announced itself in a
/// window nobody has open would be an update nobody ever runs.
pub fn check(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tray::updates_say(&app, "Checking for updates…");

        let updater = match app.updater() {
            Ok(updater) => updater,
            Err(e) => return tray::updates_say(&app, &format!("Cannot check for updates: {e}")),
        };

        match updater.check().await {
            Err(e) => tray::updates_say(&app, &format!("Could not check for updates: {e}")),
            Ok(None) => tray::updates_say(
                &app,
                &format!("Up to date ({})", app.package_info().version),
            ),
            Ok(Some(update)) => {
                let version = update.version.clone();
                tray::updates_say(&app, &format!("Downloading dotcontent {version}…"));

                /*
                 * The worker goes first, and it has to.
                 *
                 * Installing hands over to the NSIS installer and ends this
                 * process without going through `RunEvent::Exit`, so the code
                 * in main.rs that kills the worker on the way out never runs.
                 * A Node process that outlived the app would keep claiming
                 * jobs from the console and spending somebody's model
                 * subscription, with nothing on screen it could be stopped
                 * from — and the new copy would start a second one beside it.
                 */
                app.state::<Worker>().stop(&app);

                match update.download_and_install(|_, _| {}, || {}).await {
                    Ok(()) => tray::updates_say(&app, &format!("Installing dotcontent {version}…")),
                    Err(e) => {
                        tray::updates_say(&app, &format!("Update to {version} failed: {e}"));
                        // The worker was stopped for an install that did not
                        // happen, so this machine would otherwise sit there
                        // taking no jobs until somebody noticed.
                        app.state::<Worker>().start(&app);
                    }
                }
            }
        }
    });
}
