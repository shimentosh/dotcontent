// The console is a web page; this app must not also be a console window
// sitting behind it on every start.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Content OS on somebody's desktop.
//!
//! Two things in one process, and the reason they are one process is the
//! person using it: a teammate who is not a developer, on Windows, whose
//! machine is meant to do the writing and the video work. They open one app.
//! It shows them the console their team already runs, and beside it — with no
//! terminal, no environment variables and no instructions to follow — it runs
//! the worker that claims jobs for this machine.
//!
//! What it deliberately is not: a second frontend. `docs/WORKER.md` settles
//! that the server keeps the UI and every decision, and this app keeps only
//! what cannot live there — where the console and the API are, this machine's
//! token, and whether the worker beside it is actually running.

mod settings;
mod tray;
mod updates;
mod windows;
mod worker;

use tauri::{AppHandle, Manager, RunEvent, State};

use worker::{View, Worker};

#[tauri::command]
fn status(app: AppHandle, worker: State<'_, Worker>) -> View {
    worker.view(&app)
}

/// Take what the person filled in, keep it, and start.
///
/// Blank means "leave it as it is", for all three fields and for two different
/// reasons.
///
/// The console shows a worker token exactly once, so a person who came back to
/// change something else will not have it any more, and demanding it again
/// would send them to Settings → Machines to mint a new one for no reason.
///
/// The two addresses are blank far more often, because most people never see
/// those fields: they are behind a disclosure, and the app already knows both
/// from the build or from the environment. Writing an empty string over that
/// would turn "I did not touch it" into "point this machine at nothing".
#[tauri::command]
fn save(
    app: AppHandle,
    worker: State<'_, Worker>,
    console_url: String,
    api_url: String,
    token: String,
) -> Result<View, String> {
    /*
     * The same rule twice, over the pair, rather than once per address written
     * out: they are saved by the same code so that a change to what "blank
     * means" cannot land on one of them and not the other.
     *
     * Each is saved only when there is something to save, or when there is
     * nothing to fall back on — and the second case is deliberately routed
     * through `normalise` too, because the sentence explaining what that
     * address is already lives there and should not be written twice.
     *
     * Both are checked before either is written, so a typo in the second field
     * does not leave the machine holding a saved first one and an error
     * message; the person fixes what they typed and Saves the pair they meant.
     */
    let fields = [
        (settings::Which::Console, console_url),
        (settings::Which::Api, api_url),
    ];
    let mut to_save = Vec::new();
    for (which, raw) in &fields {
        let raw = raw.trim();
        if !raw.is_empty() || settings::address(&app, *which).url.is_empty() {
            to_save.push((*which, settings::normalise(*which, raw)?));
        }
    }
    for (which, url) in to_save {
        settings::set_url(&app, which, &url)?;
    }

    let typed = token.trim();
    if !typed.is_empty() {
        settings::set_token(typed)?;
    } else if settings::token().is_empty() {
        return Err(
            "Paste this machine's token. On the console it is Settings → Machines → add this machine, \
             and it is shown once."
                .into(),
        );
    }

    worker.start(&app);
    windows::console(&app);
    Ok(worker.view(&app))
}

#[tauri::command]
fn restart(app: AppHandle, worker: State<'_, Worker>) {
    worker.start(&app);
}

#[tauri::command]
fn open_console(app: AppHandle) {
    windows::console(&app);
}

fn main() {
    tauri::Builder::default()
        /*
         * Registered even in a build with nowhere to look, because the plugin
         * is where `updater()` comes from and the alternative is a `cfg` that
         * would have to be flipped in Rust to turn updating on. The whole
         * point of src/updates.rs is that turning it on is two entries in
         * tauri.conf.json; with no endpoint the check simply says so and the
         * menu item that would run it is never built.
         */
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Worker::default())
        .invoke_handler(tauri::generate_handler![
            status,
            save,
            restart,
            open_console
        ])
        .setup(|app| {
            let app = app.handle().clone();
            tray::install(&app)?;

            // First run has something missing, so it gets the only screen this
            // app owns. On an installer built with both addresses that is the
            // token and nothing else. Every run after that opens the console
            // itself, which is what somebody double-clicked the icon for.
            if settings::console_url(&app).is_empty()
                || settings::api_url(&app).is_empty()
                || settings::token().is_empty()
            {
                windows::setup(&app);
            } else {
                windows::console(&app);
            }

            let worker = app.state::<Worker>();
            worker.start(&app);
            /*
             * A worker that could not start at all — no Node, no worker files,
             * nothing configured — is put in front of the person rather than
             * left as a line in a tray menu nobody has a reason to open. This
             * is the whole difference between this app and a terminal: the
             * failure has to arrive without being asked for.
             */
            if worker.stuck() {
                windows::setup(&app);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Content OS could not start its window system")
        .run(|app, event| match event {
            /*
             * Closing the window does not quit.
             *
             * The worker is why this app is installed at all, and a machine
             * that stops taking jobs because somebody closed a browser window
             * is a machine that is only ever working while it is being
             * watched. `code.is_none()` is the last window closing; a `code`
             * is somebody having chosen Quit, which is allowed through.
             *
             * This is only honest because of the tray: what carries on running
             * is visible, says what it is doing, and can be stopped from the
             * same menu.
             */
            RunEvent::ExitRequested { code, api, .. } => {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
            /*
             * And when it really is quitting, the worker goes with it. A Node
             * process outliving its window would keep claiming jobs, keep
             * spending a model subscription, and have nothing on screen it
             * could be stopped from.
             */
            RunEvent::Exit => app.state::<Worker>().stop(app),
            _ => {}
        });
}
