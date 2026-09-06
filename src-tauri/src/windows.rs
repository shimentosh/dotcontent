//! The two windows, and why there are only two.
//!
//! **The console window is a webview onto the team's server.** It is not a
//! port of the frontend and there is no copy of the UI in this repository's
//! `src-tauri`: the console is served by whoever runs the server, so a
//! template change or a bug fix reaches every teammate the moment it is
//! deployed, without fifteen desktops needing an update. The webview signs in
//! as a person, with the console's own cookie, exactly as a browser does.
//!
//! **The setup window is the one screen this app draws**, because the console
//! address and this machine's worker token have to be given before there is a
//! console to ask, and because a person whose worker is stuck needs somewhere
//! to read that is not a terminal.

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

use crate::settings;

pub fn console(app: &AppHandle) {
    if let Some(open) = app.get_webview_window("console") {
        let _ = open.show();
        let _ = open.set_focus();
        return;
    }

    // Anything wrong with the address puts the person in front of the field
    // that holds it, rather than in front of an empty window or nothing at all.
    let url = settings::console_url(app);
    let Ok(url) = Url::parse(&url) else {
        return setup(app);
    };

    if WebviewWindowBuilder::new(app, "console", WebviewUrl::External(url))
        .title("Content OS")
        .inner_size(1280.0, 860.0)
        .build()
        .is_err()
    {
        setup(app);
    }
}

pub fn setup(app: &AppHandle) {
    if let Some(open) = app.get_webview_window("setup") {
        let _ = open.show();
        let _ = open.set_focus();
        return;
    }

    // If this fails there is nowhere left to say so — no window and, on a first
    // run, no tray status worth reading. It is also the one window whose
    // contents are compiled into the binary, so the only way it fails is a
    // webview that is not there at all, which the installer's own bootstrapper
    // is what prevents.
    let _ = WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("setup.html".into()))
        .title("Content OS — this machine")
        // Tall enough for the three panels — status, sign in, addresses — on a
        // first run, because the one that matters on a first run is the middle
        // one, and a window that opens with the sign-in below the fold is a
        // window somebody reads as "nothing here to do".
        .inner_size(560.0, 780.0)
        .build();
}
