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

mod account;
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

/// Sign in as a person, and set this machine up.
///
/// The ordinary way in, and the only one a teammate should ever need: an email
/// and a password. Everything after that is this app's job — keep the session,
/// mint this machine's worker token through `POST /api/machines`, store it,
/// start the worker — and it is `src/account.rs` that does it, including every
/// sentence for every way it can fail.
///
/// The console is opened at the end because that is what the person came for.
/// A window that stayed on the setup screen after a successful sign-in would
/// be a window that looks like nothing happened.
#[tauri::command]
async fn sign_in(app: AppHandle, email: String, password: String) -> Result<Done, String> {
    let done = account::sign_in(&app, &email, &password).await?;
    let view = restart_worker(&app);
    windows::console(&app);
    Ok(Done::from(done, view))
}

/// Set this machine up again, without asking for a password.
///
/// The repair, and the reason the session is kept rather than used once: a
/// machine somebody revoked, or a credential store that was cleared, would
/// otherwise cost a password for something the person did not break. It is
/// offered only while this app holds a session, and says so when it does not.
#[tauri::command]
async fn enrol(app: AppHandle) -> Result<Done, String> {
    let done = account::enrol(&app).await?;
    let view = restart_worker(&app);
    Ok(Done::from(done, view))
}

/// What just happened, and what is true now.
///
/// The window needs both: a sentence about the sign-in that has just finished,
/// and the same `View` every other command hands back so the status panel and
/// the addresses are redrawn from one answer rather than from a second call
/// that could disagree with this one.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Done {
    said: String,
    view: View,
}

impl Done {
    fn from(done: account::Enrolled, view: View) -> Self {
        let machine = if done.machine.is_empty() {
            "this machine".to_string()
        } else {
            done.machine
        };
        Done {
            said: if done.minted {
                format!(
                    "Signed in as {}. This computer is now set up as \"{machine}\" and is taking \
                     jobs. You can rename it on the console, in Settings → Machines.",
                    done.email
                )
            } else {
                format!(
                    "Signed in as {}. This computer was already set up as \"{machine}\", so it \
                     kept it rather than adding a second one.",
                    done.email
                )
            },
            view,
        }
    }
}

fn restart_worker(app: &AppHandle) -> View {
    let worker = app.state::<Worker>();
    worker.start(app);
    worker.view(app)
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

    /*
     * The token is the way in for somebody who needs it, and no longer the way
     * in. Since signing in mints this machine's token by itself, a blank field
     * here is the ordinary case rather than a mistake, and refusing the Save
     * over it — which this used to do — would stop a person fixing an address
     * before they can sign in at all. What is still missing is said by the
     * worker's own status the moment it tries to start, in the same words and
     * in the place a person is already looking.
     */
    let typed = token.trim();
    if !typed.is_empty() {
        settings::set_token(typed)?;
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
            sign_in,
            enrol,
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
