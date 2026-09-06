//! The things this app is told, kept apart on purpose.
//!
//! `docs/WORKER.md` — "The desktop app holds two credentials, on purpose" —
//! settles the shape: the webview signs in as a *person*, with the console's
//! own session cookie, exactly as a browser does; the worker holds a *machine*
//! bearer token minted in Settings → Machines. They are different principals
//! with different lifetimes and different blast radii, and merging them would
//! produce either a session that survives Team → Remove or a worker token that
//! can read the whole content library.
//!
//! So this file owns exactly one of the two — and, since the app started
//! signing people in itself, one thing that is neither. What lives here is:
//!
//! - **the two addresses** — the console this app opens a window onto, and the
//!   API the worker calls for jobs. Each comes from the build, from the
//!   runtime environment, or from a JSON file under the app's config
//!   directory; `pick` below is the order and the reasoning, and both go
//!   through it. Neither is a secret — they are the URLs a browser would show
//!   — and both have to be readable by a person debugging their own machine.
//! - **the worker token**, in the operating system's credential store, never
//!   in that file. The console keeps only its sha256 precisely so a database
//!   dump is not a list of live credentials; writing the plaintext into
//!   `%APPDATA%` would undo that at the other end, where it is trivially
//!   readable by anything running as this user and would end up in the first
//!   backup somebody takes of their profile.
//! - **the session** this app signed in with, in the credential store beside
//!   the token and for the same reason. It is the *person's* credential, not
//!   the machine's, so it is emphatically not a third principal: it is the
//!   same session row a browser would have held in a cookie, sent as
//!   `Authorization: Session <id>` because a webview on a local origin cannot
//!   keep a cookie for somebody else's server. It exists here at all because
//!   the deployment this is heading for has no hosted console to visit, so a
//!   token minted in Settings → Machines and pasted in is an instruction with
//!   nowhere to follow it: the app asks for an email and a password, and mints
//!   this machine's token for itself through `POST /api/machines`.
//!
//! Two credentials in one store, then, and it is worth being precise about why
//! that is still the two `docs/WORKER.md` argues for rather than a merge. They
//! are separate entries with separate names, they authenticate different
//! things — a person, and a machine — and either can be taken away without the
//! other: Settings → Team ends the session, Settings → Machines revokes the
//! token. What this app does is hold both, which is exactly what a teammate
//! with a browser and a pasted token was already doing.
//!
//! **Why the addresses are two and not one.** `docs/DEPLOYING.md` puts the web
//! app on `APP_HOST` and the NestJS API on `API_HOST` — two hostnames, and the
//! browser calls the API cross-origin, which is why `lib/api-base.ts` reads
//! `NEXT_PUBLIC_API_URL` and why `docker-compose.prod.yml` has to pass it as a
//! *build* arg. There is no `/api` under Next to fall back on. An app that
//! resolved one address and handed the worker the console's origin would
//! therefore 404 every request that worker made on any real deployment; and a
//! checkout is no kinder, because there the console is Next on :3333 and the
//! API is NestJS on :4000.
//!
//! **And why neither is derived from the other.** Putting `api.` in front of
//! the console's host is this repository's compose convention, not a rule:
//! `docs/DEPLOYING.md` is explicit that the two may be anywhere, needing only
//! a shared `COOKIE_DOMAIN` between them. A guess that is usually right is
//! worse here than a value that is always stated, because it does not fail for
//! the person who made it — it fails months later, on somebody else's DNS, as
//! a teammate whose machine will not connect and who has nothing on their
//! screen that would explain why.

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

/// And the person's session, under its own name in the same store.
///
/// A separate entry rather than a second field in one blob, because they are
/// separately revoked and separately replaced: signing in again writes this
/// and leaves the machine's token alone, and a machine re-enrolled writes the
/// token and leaves the session alone. It is named for what it is so that
/// somebody scrolling through Windows Credential Manager can tell the two
/// apart without opening either.
const SESSION_ACCOUNT: &str = "console-session";

/// Which of the two addresses is being talked about.
///
/// They are found by the same `pick`, saved in the same file, and drawn by the
/// same code on the same screen, so almost everything about them is shared.
/// What differs is the name of the variable that carries one, the sentence
/// that says what it is for, and the example that shows its shape — and those
/// three live here, in one place, so that the rule for finding them can stay a
/// single function rather than becoming two that drift.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Which {
    Console,
    Api,
}

impl Which {
    /// The environment variable that carries it — deliberately the same name
    /// at runtime and at compile time, and the same name the worker itself
    /// reads in `worker/config.ts`, so that somebody who has learned it in one
    /// place has learned it everywhere.
    pub fn var(self) -> &'static str {
        match self {
            Which::Console => "CONTENTOS_CONSOLE_URL",
            Which::Api => "CONTENTOS_API_URL",
        }
    }

    /// The shape of the answer, for the messages that have to show one.
    fn example(self) -> &'static str {
        match self {
            Which::Console => "https://contentos.yourteam.com",
            Which::Api => "https://api.contentos.yourteam.com",
        }
    }

    /// What to say to somebody who was asked for this address and left it
    /// blank.
    ///
    /// The API's sentence is longer than the console's, and has to be: the
    /// console is the thing they already open in a browser, whereas nobody has
    /// a reason to know the worker calls a *second* host until they are told,
    /// and "the API address" on its own would send them off to guess one.
    pub fn missing(self) -> &'static str {
        match self {
            Which::Console => {
                "The console address is where your team's Content OS is, for example \
                 https://contentos.yourteam.com."
            }
            Which::Api => {
                "The API address is the server this machine's worker asks for jobs. It is a \
                 different host from the console — https://api.contentos.yourteam.com beside \
                 https://contentos.yourteam.com on a server, http://localhost:4000 beside \
                 http://localhost:3333 in a checkout. Whoever set up the server knows it."
            }
        }
    }
}

/// The file's shape.
///
/// `#[serde(default)]` is what lets a `settings.json` written before there was
/// an API address in it parse into one that has an empty one, instead of
/// failing to parse and taking the saved console address down with it.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Stored {
    console_url: String,
    api_url: String,
    /// The machine row this computer already has on the console, if it has
    /// one. Not a credential — it is the id the picker shows beside a name —
    /// and it is what stops a second machine being minted on every sign-in.
    machine_id: String,
    /// Who signed in here last, for the one line on the setup window that says
    /// so. The session itself is in the credential store; this is the label,
    /// and it is only ever shown while there is a session to go with it.
    account_email: String,
}

fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("settings.json"))
}

/// Which of the three places the address in use came from.
///
/// Carried all the way to the setup window, because it decides what the person
/// reading it is looking at and therefore what they should do about it. An
/// address that came out of the installer is not theirs to know or to check;
/// one saved here is something somebody did to this machine on purpose; one
/// out of the environment belongs to a checkout and will vanish with the
/// terminal it was exported in. Three different sentences, so three variants
/// rather than "is it set".
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Source {
    Development,
    Machine,
    BuiltIn,
    Nothing,
}

impl Source {
    /// What the setup page keys its markup off.
    pub fn id(self) -> &'static str {
        match self {
            Source::Development => "development",
            Source::Machine => "this-machine",
            Source::BuiltIn => "built-in",
            Source::Nothing => "none",
        }
    }

    /// Where it came from, in the app's own words, shown under the address.
    ///
    /// Only the development sentence needs to know which of the two it is
    /// describing, and it needs to badly: the whole use of that line is to
    /// name the variable that has to go before anything saved here will take
    /// effect, and naming the wrong one of the two would send somebody hunting
    /// a variable that was never the problem.
    pub fn words(self, which: Which) -> &'static str {
        match (self, which) {
            (Source::Development, Which::Console) => {
                "From CONTENTOS_CONSOLE_URL in this window's environment — a development setting, \
                 which wins over everything below."
            }
            (Source::Development, Which::Api) => {
                "From CONTENTOS_API_URL in this window's environment — a development setting, \
                 which wins over everything below."
            }
            (Source::Machine, _) => "Set on this machine.",
            (Source::BuiltIn, _) => "Built in when this copy of Content OS was made.",
            (Source::Nothing, _) => "",
        }
    }
}

/// One resolved address: which of the two it is, what it is, and where it came
/// from.
pub struct Address {
    pub which: Which,
    pub url: String,
    pub source: Source,
}

impl Address {
    /// The sentence under it on the setup page — written here, where the
    /// places are decided, rather than in the page, so that adding a fourth
    /// place cannot leave the screen describing three.
    pub fn words(&self) -> &'static str {
        self.source.words(self.which)
    }

    /// What this copy was *built* with, whatever is in use now. The page shows
    /// it only to somebody who has overridden this address on their own
    /// machine, so that one typo in an override cannot hide the correct
    /// address with no way back to it but deleting settings.json.
    pub fn built_in(&self) -> &'static str {
        built_in(self.which).unwrap_or_default()
    }
}

/// The address this binary was compiled with, if it was compiled with one.
///
/// `option_env!` bakes in whatever the *build* machine's environment said, so
/// a production installer carries the team's console and the team's API and
/// nobody installing it ever types an address. It is `option_env!` rather than
/// `env!` because a build without one has to keep working: the app then asks,
/// exactly as it always did, which is the only honest thing to do when there
/// is genuinely nothing to fall back on.
///
/// The match is here rather than at the call sites because `option_env!` takes
/// a literal — there is no reading `which.var()` at compile time — and keeping
/// it in one place is what stops a third address, later, from being added to
/// the resolver and forgotten by the compiler.
///
/// `build.rs` tells Cargo to rebuild when either variable changes. Without
/// those two lines, changing one and rebuilding gives you yesterday's address
/// in today's installer, and nothing on screen says so.
pub fn built_in(which: Which) -> Option<&'static str> {
    match which {
        Which::Console => option_env!("CONTENTOS_CONSOLE_URL"),
        Which::Api => option_env!("CONTENTOS_API_URL"),
    }
}

/// The whole file, or an empty one.
///
/// A file that is missing, unreadable or not JSON reads the same as "nothing
/// has been set on this machine": the two places below it are still there to
/// answer, and an app that refused to start over a stray character in
/// `%APPDATA%` would be worse than one that falls back to what it was built
/// with.
fn stored(app: &AppHandle) -> Stored {
    file(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<Stored>(&raw).ok())
        .unwrap_or_default()
}

/// What is saved on this machine for one of the two, if anything is.
fn saved(app: &AppHandle, which: Which) -> String {
    let stored = stored(app);
    match which {
        Which::Console => stored.console_url,
        Which::Api => stored.api_url,
    }
}

/// One of the two addresses this app is using, and where it came from.
pub fn address(app: &AppHandle, which: Which) -> Address {
    pick(
        which,
        std::env::var(which.var()).ok().as_deref(),
        Some(saved(app, which).as_str()),
        built_in(which),
    )
}

/// The console: the page a person opens, and the only one of the two they have
/// ever seen in a browser.
pub fn console_url(app: &AppHandle) -> String {
    address(app, Which::Console).url
}

/// The API: what the worker calls for jobs. Never the console's — see the note
/// at the top of this file for why that 404s on any real deployment.
pub fn api_url(app: &AppHandle) -> String {
    address(app, Which::Api).url
}

/// The order, with nothing else in it so that it can be read — and tested —
/// on its own.
///
/// One function for both addresses, deliberately. They differ in what they
/// name, not in how they are found, and a second copy of this rule is a second
/// copy that gets a fix the first one does not.
///
/// Highest first, and each place beats the one below it for a reason:
///
/// 1. **The runtime environment.** This is a checkout: somebody exported
///    `CONTENTOS_CONSOLE_URL` and `CONTENTOS_API_URL` and ran `npm run
///    desktop`. It has to beat both of the others, because a developer whose
///    binary was compiled against the team's servers — or who has a
///    `settings.json` left over from testing an installer — would otherwise
///    point a debug worker at production and have it claim real jobs. The
///    variable is the loudest thing in the room, so it wins.
/// 2. **What is saved on this machine.** The escape hatch, and the reason it
///    beats the built-in value: one person on a second team, or on a staging
///    console, sets it once and it survives every reinstall of the same
///    installer. If the built-in value won, the only way to move one machine
///    would be to build a second installer for it.
/// 3. **What was baked in at compile time.** The floor, not the ceiling: it is
///    what a teammate gets when they have done nothing at all, which is the
///    whole point — the person who built the installer already knew both
///    addresses, so nobody installing it should have to.
///
/// Anything that is not a usable address is skipped rather than accepted, so a
/// blank `apiUrl` in a `settings.json` written before there was one falls
/// through to the built-in value instead of shadowing it with nothing.
fn pick(which: Which, env: Option<&str>, saved: Option<&str>, built_in: Option<&str>) -> Address {
    for (raw, source) in [
        (env, Source::Development),
        (saved, Source::Machine),
        (built_in, Source::BuiltIn),
    ] {
        if let Some(url) = raw.and_then(|raw| normalise(which, raw).ok()) {
            return Address { which, url, source };
        }
    }
    Address {
        which,
        url: String::new(),
        source: Source::Nothing,
    }
}

/// Change one field of the file, keeping everything else in it.
///
/// Read, change, write the whole object back — in one place, because the file
/// is one JSON object and a write built from a single value would drop the
/// rest of it silently. That is not hypothetical: the setup window saves the
/// two addresses one after the other, and the second write of a single Save
/// would erase the first. It is a sharper edge now that the machine id and the
/// signed-in email live here too, since those are written from a different
/// screen entirely.
fn write(app: &AppHandle, change: impl FnOnce(&mut Stored)) -> Result<(), String> {
    let path = file(app).ok_or("This machine has no application data folder to write to.")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    }
    let mut stored = stored(app);
    change(&mut stored);
    let body = serde_json::to_string_pretty(&stored).map_err(|e| e.to_string())?;
    fs::write(&path, body).map_err(|e| format!("Could not write {}: {e}", path.display()))
}

/// Save one address on this machine, keeping the other.
pub fn set_url(app: &AppHandle, which: Which, url: &str) -> Result<(), String> {
    write(app, |stored| match which {
        Which::Console => stored.console_url = url.to_string(),
        Which::Api => stored.api_url = url.to_string(),
    })
}

/// The machine this computer is already enrolled as, or an empty string.
pub fn machine_id(app: &AppHandle) -> String {
    stored(app).machine_id
}

pub fn set_machine_id(app: &AppHandle, id: &str) -> Result<(), String> {
    write(app, |stored| stored.machine_id = id.to_string())
}

/// Who is signed in here, as far as this machine knows — and only while there
/// is a session to go with it.
///
/// The two are checked together on the way out rather than being kept in step
/// on the way in, because they live in two different places and one of them
/// can vanish on its own: a credential store that has been cleared, a profile
/// restored without it. A name with no session behind it would be a window
/// saying "signed in as Rakib" over a worker that cannot enrol anything.
pub fn account_email(app: &AppHandle) -> String {
    if session().is_empty() {
        return String::new();
    }
    stored(app).account_email
}

pub fn set_account_email(app: &AppHandle, email: &str) -> Result<(), String> {
    write(app, |stored| stored.account_email = email.to_string())
}

/// The token, or an empty string when this machine has never been given one.
///
/// A store that is locked or refuses to answer reads the same as "no token
/// here", and the worker then says it is not set up — which is the honest
/// thing for the person to see, and better than an app that will not start.
pub fn token() -> String {
    secret(ACCOUNT)
}

pub fn set_token(value: &str) -> Result<(), String> {
    set_secret(ACCOUNT, value, "this machine's token")
}

/// The session this app signed in with, or an empty string.
///
/// Read exactly like the token, and unreadable for exactly the same reasons —
/// a locked store, a profile without it — which reads as "nobody is signed in
/// here", which is a screen with a sign-in form on it rather than an app that
/// will not start.
pub fn session() -> String {
    secret(SESSION_ACCOUNT)
}

pub fn set_session(value: &str) -> Result<(), String> {
    set_secret(SESSION_ACCOUNT, value, "your sign-in")
}

fn secret(account: &str) -> String {
    keyring::Entry::new(SERVICE, account)
        .and_then(|entry| entry.get_password())
        .unwrap_or_default()
}

/// One place that writes to the credential store, and one sentence shape for
/// when it refuses.
///
/// `what` is the person's word for the thing — "this machine's token", "your
/// sign-in" — because a store that says no is a rare enough event that the
/// message has to be readable on its own, without the reader knowing which of
/// the two calls made it.
fn set_secret(account: &str, value: &str, what: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, account)
        .map_err(|e| format!("Could not open this machine's credential store: {e}"))?;
    entry.set_password(value).map_err(|e| {
        format!("Could not save {what} to this machine's credential store: {e}")
    })
}

/// Turn what somebody typed into the origin that will actually be used.
///
/// Deliberately forgiving in one direction only. A person pastes
/// `contentos.team.com` or a whole page's URL out of their browser bar, and
/// neither should be an error; but a guess about the *scheme* is a guess about
/// whether the token crosses the network in the clear, so anything without one
/// becomes `https://` rather than `http://`. Somebody working against a local
/// API types the `http://` themselves, which is exactly the moment they should
/// have to.
///
/// `which` only ever chooses the words. The rule itself is one rule: the two
/// addresses are checked identically, because a difference between them here
/// would be a difference nobody could predict from the screen.
pub fn normalise(which: Which, raw: &str) -> Result<String, String> {
    let typed = raw.trim();
    if typed.is_empty() {
        return Err(which.missing().into());
    }
    let with_scheme = if typed.contains("://") {
        typed.to_string()
    } else {
        format!("https://{typed}")
    };

    let url = Url::parse(&with_scheme).map_err(|_| {
        format!(
            "\"{typed}\" is not a web address. It should look like {}.",
            which.example()
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

/// The order is the whole feature, so it is the thing that is tested.
///
/// `pick` takes its three candidates as arguments rather than reading them
/// itself precisely so this can exist: a test that had to set process-wide
/// environment variables would race every other test in the binary, and one
/// that had to write a `settings.json` would need an `AppHandle`, which needs
/// a window system.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn development_beats_everything() {
        let got = pick(
            Which::Console,
            Some("http://localhost:3333"),
            Some("https://saved.example.com"),
            Some("https://built-in.example.com"),
        );
        assert_eq!(got.url, "http://localhost:3333");
        assert_eq!(got.source, Source::Development);
    }

    #[test]
    fn this_machine_beats_the_build() {
        let got = pick(
            Which::Console,
            None,
            Some("https://saved.example.com"),
            Some("https://built-in.example.com"),
        );
        assert_eq!(got.url, "https://saved.example.com");
        assert_eq!(got.source, Source::Machine);
    }

    #[test]
    fn the_build_is_the_floor() {
        let got = pick(
            Which::Console,
            None,
            None,
            Some("https://built-in.example.com"),
        );
        assert_eq!(got.url, "https://built-in.example.com");
        assert_eq!(got.source, Source::BuiltIn);
    }

    /// A `settings.json` written before there was anything else to fall back
    /// on holds `""`, and it must not shadow the address the installer was
    /// built with.
    #[test]
    fn nothing_usable_falls_through() {
        let got = pick(
            Which::Console,
            Some(""),
            Some("   "),
            Some("https://built-in.example.com"),
        );
        assert_eq!(got.url, "https://built-in.example.com");
        assert_eq!(got.source, Source::BuiltIn);
    }

    #[test]
    fn a_build_told_nothing_asks() {
        let got = pick(Which::Console, None, None, None);
        assert!(got.url.is_empty());
        assert_eq!(got.source, Source::Nothing);
    }

    /// Candidates are normalised on the way in, so a `CONTENTOS_CONSOLE_URL`
    /// with a trailing slash cannot make every request the worker sends
    /// contain a double one.
    #[test]
    fn candidates_are_tidied_not_taken_literally() {
        assert_eq!(
            pick(Which::Console, Some("contentos.team.com/"), None, None).url,
            "https://contentos.team.com"
        );
    }

    /// The API address is found by exactly the same rule as the console's,
    /// which is the point of `pick` taking a `which` rather than there being
    /// two of it.
    #[test]
    fn the_api_address_is_found_the_same_way() {
        let got = pick(
            Which::Api,
            None,
            Some("https://api.saved.example.com"),
            Some("https://api.built-in.example.com"),
        );
        assert_eq!(got.url, "https://api.saved.example.com");
        assert_eq!(got.source, Source::Machine);
    }

    /// Neither address is ever invented from the other. A build that was told
    /// where the console is and nothing else has no API address at all, and
    /// has to say so: `api.` in front of the console's host is this
    /// repository's compose convention, and `docs/DEPLOYING.md` is explicit
    /// that the two hosts may be anywhere.
    #[test]
    fn one_address_is_never_invented_from_the_other() {
        let console = pick(
            Which::Console,
            None,
            None,
            Some("https://contentos.team.com"),
        );
        let api = pick(Which::Api, None, None, None);
        assert_eq!(console.url, "https://contentos.team.com");
        assert!(api.url.is_empty());
        assert_eq!(api.source, Source::Nothing);
    }

    /// A blank field says which address it wanted. The API's sentence carries
    /// its own explanation, because somebody who has only ever opened the
    /// console in a browser has no reason to know there is a second host.
    #[test]
    fn a_blank_field_says_what_it_was_asking_for() {
        let console = normalise(Which::Console, "  ").unwrap_err();
        let api = normalise(Which::Api, "").unwrap_err();
        assert!(console.contains("console address"));
        assert!(api.contains("API address"));
        assert!(api.contains("worker"));
    }

    /// The environment variable is named in the development sentence, and it
    /// has to be the right one of the two — that line exists to tell somebody
    /// which variable to unset.
    #[test]
    fn the_development_line_names_its_own_variable() {
        assert!(Source::Development
            .words(Which::Console)
            .contains("CONTENTOS_CONSOLE_URL"));
        assert!(Source::Development
            .words(Which::Api)
            .contains("CONTENTOS_API_URL"));
    }

    /// Not an assertion — a window onto the build.
    ///
    /// `cargo test -- --nocapture` prints the addresses this binary was
    /// compiled with, which is how somebody checks that the values they
    /// exported actually reached the compiler rather than trusting that they
    /// did. It is the same `option_env!` the app itself resolves through, so a
    /// build that prints an address here is a build that ships one — and it
    /// prints both, because an installer carrying one of the two is exactly
    /// the half-built artifact worth catching before it is handed out.
    #[test]
    fn says_which_addresses_this_build_carries() {
        for which in [Which::Console, Which::Api] {
            match built_in(which) {
                Some(url) => println!("built in: {} = {url}", which.var()),
                None => println!(
                    "built in: {} = nothing — this build will ask the person who installs it",
                    which.var()
                ),
            }
        }
    }
}
