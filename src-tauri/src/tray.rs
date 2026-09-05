//! The tray icon: where this machine says what it is doing.
//!
//! It is not a nicety. The window shows the console, which is a web page on
//! somebody else's server — so when the worker cannot reach that server, or
//! Node is missing, or the token was refused, the window is the *last* place
//! that can tell you. Closing the window does not stop the worker either
//! (that is the point of running it beside the console), so without a tray
//! there would be a process claiming jobs on your computer with nothing on
//! screen admitting it exists.
//!
//! The first line of the menu is therefore the status itself, disabled: it is
//! a statement, not a button.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

use crate::windows;
use crate::worker::{View, Worker};

/// Kept in app state so any thread that learns something new — the ones
/// reading the worker's output, mostly — can put it in the menu without
/// having to be handed the menu.
struct StatusItem(MenuItem<Wry>);

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, "status", "Starting…", false, None::<&str>)?;
    let console = MenuItem::with_id(app, "console", "Open the console", true, None::<&str>)?;
    let setup = MenuItem::with_id(app, "setup", "This machine…", true, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", "Restart the worker", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Content OS", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &status,
            &PredefinedMenuItem::separator(app)?,
            &console,
            &setup,
            &restart,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("main")
        // Compiled in from bundle.icon in tauri.conf.json, so this is only
        // ever None if that entry was removed.
        .icon(
            app.default_window_icon()
                .cloned()
                .expect("bundle.icon in tauri.conf.json puts the app icon here at compile time"),
        )
        .tooltip("Content OS")
        .menu(&menu)
        // A left click on a tray icon is somebody asking "what is it doing?",
        // and the answer is the first line of this menu.
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "console" => windows::console(app),
            "setup" => windows::setup(app),
            "restart" => app.state::<Worker>().start(app),
            "quit" => {
                // Order matters. The worker is killed while there is still an
                // app to kill it from; `app.exit` unwinds the event loop, and
                // anything left after that is a process nobody owns.
                app.state::<Worker>().stop(app);
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    app.manage(StatusItem(status));
    Ok(())
}

/// Put the current state in the menu. Called on every change, from whichever
/// thread noticed it — Tauri runs the update on the main thread itself.
pub fn say(app: &AppHandle, view: &View) {
    if let Some(item) = app.try_state::<StatusItem>() {
        let _ = item.0.set_text(view.title);
    }
}
