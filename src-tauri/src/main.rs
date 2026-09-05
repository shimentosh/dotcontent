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
//! what cannot live there — where the console is, this machine's token, and
//! whether the worker beside it is actually running.

mod settings;
mod tray;
mod windows;
mod worker;

use tauri::{AppHandle, Manager, RunEvent, State};

use worker::{View, Worker};

#[tauri::command]
fn status(app: AppHandle, worker: State<'_, Worker>) -> View {
    worker.view(&app)
}

/// Take the two answers, keep them, and start.
///
/// A blank token means "leave the one you have". The console shows a worker
/// token exactly once, so a person who came back to correct a typo in the
/// address will not have it any more, and demanding it again would send them
/// to Settings → Machines to mint a new one for no reason.
#[tauri::command]
fn save(
    app: AppHandle,
    worker: State<'_, Worker>,
    console_url: String,
    token: String,
) -> Result<View, String> {
    let url = settings::normalise(&console_url)?;
    settings::set_console_url(&app, &url)?;

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

            // First run has nothing to load, so it gets the only screen this
            // app owns. Every run after that opens the console itself, which
            // is what somebody double-clicked the icon for.
            if settings::console_url(&app).is_empty() || settings::token().is_empty() {
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
