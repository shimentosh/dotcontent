//! The two things this app is told, kept in two different places on purpose.
//!
//! `docs/WORKER.md` — "The desktop app holds two credentials, on purpose" —
//! settles the shape: the webview signs in as a *person*, with the console's
//! own session cookie, exactly as a browser does; the worker holds a *machine*
//! bearer token minted in Settings → Machines. They are different principals
//! with different lifetimes and different blast radii, and merging them would
//! produce either a session that survives Team → Remove or a worker token that
//! can read the whole content library.
//!
//! So this file owns exactly one of the two. The cookie is the webview's
//! business and is never touched here. What lives here is:
//!
//! - **the console address**, in a JSON file under the app's config directory.
//!   It is not a secret — it is the URL a browser would show — and it has to be
//!   readable by a person debugging their own machine.
//! - **the worker token**, in the operating system's credential store, never
//!   in that file. The console keeps only its sha256 precisely so a database
//!   dump is not a list of live credentials; writing the plaintext into
//!   `%APPDATA%` would undo that at the other end, where it is trivially
//!   readable by anything running as this user and would end up in the first
//!   backup somebody takes of their profile.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Url};

/// What Windows Credential Manager (or the Keychain, or the Secret Service)
/// files this under. It matches the bundle identifier so that a person looking
/// through their own credentials can tell what put it there.
const SERVICE: &str = "com.contentos.desktop";

/// One machine, one token — the console mints it per machine, so there is
/// nothing here to key by a user name.
const ACCOUNT: &str = "worker-token";

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Stored {
    console_url: String,
}

fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("settings.json"))
}

pub fn console_url(app: &AppHandle) -> String {
    file(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<Stored>(&raw).ok())
        .map(|s| s.console_url)
        .unwrap_or_default()
}

pub fn set_console_url(app: &AppHandle, url: &str) -> Result<(), String> {
    let path = file(app).ok_or("This machine has no application data folder to write to.")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    }
    let body = serde_json::to_string_pretty(&Stored {
        console_url: url.to_string(),
    })
    .map_err(|e| e.to_string())?;
    fs::write(&path, body).map_err(|e| format!("Could not write {}: {e}", path.display()))
}

/// The token, or an empty string when this machine has never been given one.
///
/// A store that is locked or refuses to answer reads the same as "no token
/// here", and the worker then says it is not set up — which is the honest
/// thing for the person to see, and better than an app that will not start.
pub fn token() -> String {
    keyring::Entry::new(SERVICE, ACCOUNT)
        .and_then(|entry| entry.get_password())
        .unwrap_or_default()
}

pub fn set_token(value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| format!("Could not open this machine's credential store: {e}"))?;
    entry
        .set_password(value)
        .map_err(|e| format!("Could not save the token to this machine's credential store: {e}"))
}

/// Turn what somebody typed into the origin the worker will be given.
///
/// Deliberately forgiving in one direction only. A person pastes
/// `contentos.team.com` or a whole page's URL out of their browser bar, and
/// neither should be an error; but a guess about the *scheme* is a guess about
/// whether the token crosses the network in the clear, so anything without one
/// becomes `https://` rather than `http://`. Somebody working against a local
/// API types the `http://` themselves, which is exactly the moment they should
/// have to.
pub fn normalise(raw: &str) -> Result<String, String> {
    let typed = raw.trim();
    if typed.is_empty() {
        return Err("The console address is where your team's Content OS is, for example https://contentos.yourteam.com.".into());
    }
    let with_scheme = if typed.contains("://") {
        typed.to_string()
    } else {
        format!("https://{typed}")
    };

    let url = Url::parse(&with_scheme).map_err(|_| {
        format!(
            "\"{typed}\" is not a web address. It should look like https://contentos.yourteam.com."
        )
    })?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!(
            "\"{typed}\" has to start with https:// (or http:// on your own network)."
        ));
    }
    if url.host_str().is_none() {
        return Err(format!("\"{typed}\" has no server name in it."));
    }

    // The worker appends its own paths to this, and joins them with a single
    // slash, so a trailing one here would make every request double it.
    Ok(with_scheme.trim_end_matches('/').to_string())
}
