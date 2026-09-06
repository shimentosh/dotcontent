//! The two windows, and why there are only two.
//!
//! **The console window is a webview onto the team's server.** It is not a
//! port of the frontend and there is no copy of the UI in this repository's
//! `src-tauri`: the console is served by whoever runs the server, so a
//! template change or a bug fix reaches every teammate the moment it is
//! deployed, without fifteen desktops needing an update. The webview signs in
//! as a person, with the console's own cookie, exactly as a browser does — and
//! that cookie now arrives by hand-off rather than by a second login form. See
//! `account::console_entry`.
//!
//! **The setup window is the one screen this app draws**, because the console
//! address and this machine's worker token have to be given before there is a
//! console to ask, and because a person whose worker is stuck needs somewhere
//! to read that is not a terminal.

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

use crate::{account, settings};

/// Open the console, signed in as whoever this app is signed in as.
///
/// Returns straight away and finishes on a background task, because getting
/// the session into that window costs one HTTP request — see
/// `account::console_entry` for what it is and why it is worth a round trip.
/// The alternative shapes are both worse: blocking would freeze whichever
/// button or tray item was clicked, and opening the window first and
/// navigating afterwards would show the console's login form for a moment
/// before replacing it, which reads as a sign-in that failed.
pub fn console(app: &AppHandle) {
    // The common case, and it must stay instant: the window is already there
    // and the person is asking to look at it. Nothing to hand off — this
    // webview signed in when it was opened.
    if focus(app, "console") {
        return;
    }

    // Anything wrong with the address puts the person in front of the field
    // that holds it, rather than in front of an empty window or nothing at all.
    // Checked here, synchronously, so that the one failure a person can fix
    // does not arrive five seconds later from a task they cannot see.
    if Url::parse(&settings::console_url(app)).is_err() {
        return setup(app);
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let entry = account::console_entry(&app).await;
        open(&app, &entry);
    });
}

/// Build the window, at whatever URL the hand-off settled on.
///
/// The existing-window check happens again here, and it is not paranoia: two
/// clicks a second apart, or a tray item pressed while the first hand-off is
/// still in flight, would otherwise each get to this point and this app would
/// have two console windows — one of them signed in as the wrong person, since
/// only one of the two codes can be spent.
fn open(app: &AppHandle, entry: &str) {
    if focus(app, "console") {
        return;
    }

    let Ok(url) = Url::parse(entry) else {
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
    if focus(app, "setup") {
        return;
    }

    // If this fails there is nowhere left to say so — no window and, on a first
    // run, no tray status worth reading. It is also the one window whose
    // contents are compiled into the binary, so the only way it fails is a
    // webview that is not there at all, which the installer's own bootstrapper
    // is what prevents.
    let _ = WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("setup.html".into()))
        .title("Content OS — this machine")
        // Sized for the sign-in, which on a first run is the whole screen: a
        // mark, a heading, two fields and a button. It used to be 780 tall for
        // three stacked panels, and everything but the sign-in is behind one
        // disclosure now — so the height was measuring content that is no
        // longer there, and an empty half-window reads as a screen still
        // loading. It grows on its own when somebody opens the diagnostics.
        .inner_size(460.0, 560.0)
        .build();
}

/// Bring a window that already exists to the front, and say whether there was
/// one. Written once because both windows want it and the console now wants it
/// twice.
fn focus(app: &AppHandle, label: &str) -> bool {
    let Some(open) = app.get_webview_window(label) else {
        return false;
    };
    let _ = open.show();
    let _ = open.set_focus();
    true
}
