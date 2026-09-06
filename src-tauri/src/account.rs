//! Signing in as a person, and enrolling this machine as a worker.
//!
//! This is the screen's whole job now. It used to ask for a worker token,
//! which somebody had to mint in Settings → Machines on a web console and
//! paste in — and the team's deployment is only the API, with no hosted
//! console to visit, so that instruction had nowhere left to be followed. So
//! the app asks for the two things a teammate already has, their email and
//! their password, and does the rest itself.
//!
//! **Two requests, two credentials, and they stay two.** `POST /auth/login`
//! with `X-Session-Return: 1` gives back the session id as well as setting the
//! cookie nothing here can use; `POST /machines` over that session mints this
//! machine's worker token. The session is the person and reaches the whole
//! console; the token is the machine and reaches the queue. `docs/WORKER.md`
//! argues that at length under "The desktop app holds two credentials, on
//! purpose", and nothing here merges them: they are separate entries in the
//! credential store, separately revoked, and the worker is handed only the
//! second one.
//!
//! **Why the HTTP is here and not in the setup page.** The page could `fetch`,
//! and it would be refused: the API's CORS list is `WEB_ORIGIN`, which is the
//! console's origin and never a webview's local one. Doing it in Rust also
//! keeps the session out of the page's DOM, where it would sit in a variable
//! any script the page ever grows could read.

use std::time::Duration;

use serde::Deserialize;
use tauri::AppHandle;

use crate::settings;

/// Long enough for a cold API behind a proxy on a bad connection, short enough
/// that a person who typed the wrong address is told so while they still
/// remember typing it.
const TIMEOUT: Duration = Duration::from_secs(20);

/// How a session travels when it is not in a cookie: `Authorization: Session
/// <id>`, read by `SessionGuard` in `api/src/common/session.guard.ts`.
///
/// Deliberately not `Bearer`, which the worker token owns. Two credentials
/// under one word is how one ends up sent where the other belongs, and the
/// direction that would matter is a machine's token being handed a person's
/// whole console. The API says the word back on login and this is the fallback
/// for a server that does not.
const SCHEME: &str = "Session";

/// What happened, for the sentence the window shows afterwards.
pub struct Enrolled {
    pub email: String,
    pub machine: String,
    /// False when this computer kept the machine it already had. The
    /// difference is worth showing: "set up as Shifa" and "already set up as
    /// Shifa" answer different questions about what just happened.
    pub minted: bool,
}

/* ── Signing in ─────────────────────────────────────────────────────────── */

/// Sign in with an email and a password, then make sure this machine is
/// enrolled.
///
/// The whole path, in the order a person experiences it, with every failure on
/// the way given its own sentence — because they are different things to go
/// and do: a typo in a password, a laptop with no network, a console that has
/// no account for you yet, an address pointing at nothing.
pub async fn sign_in(app: &AppHandle, email: &str, password: &str) -> Result<Enrolled, String> {
    let email = email.trim();
    if email.is_empty() || password.is_empty() {
        return Err("Fill in your email and your password.".into());
    }

    let api = api(app)?;
    let http = client()?;

    let me = login(&http, &api, email, password).await?;
    let Some(session) = me.session.clone().filter(|s| !s.is_empty()) else {
        /*
         * Signed in, and handed nothing to keep. Only one thing does this: an
         * API older than the `X-Session-Return` header, which sets the cookie
         * and returns the user. It has to say so precisely, because everything
         * the person can see says it worked — and the fix is on the server,
         * not on this machine.
         */
        return Err(format!(
            "{api} signed you in but did not give this app a session to keep, so it cannot set \
             this machine up. That server is older than this app: whoever runs it needs to \
             update it. Until then you can still paste a machine token below."
        ));
    };

    settings::set_session(&session)?;
    settings::set_account_email(app, &me.email)?;

    let header = authorization(me.scheme.as_deref().unwrap_or(SCHEME), &session);
    let machine = enrol_as(app, &http, &api, &header, &me.id).await?;
    Ok(Enrolled {
        email: me.email,
        machine: machine.0,
        minted: machine.1,
    })
}

/// The sign-in request itself, with nothing stored and nothing decided.
///
/// Separated from the flow above so that the conversation with a real API can
/// be run on its own — see the test at the bottom of this file, which is the
/// only way to find out that these `Deserialize` structs still match what the
/// server actually sends. A field renamed on the API would otherwise typecheck
/// perfectly here and fail on a teammate's laptop.
async fn login(
    http: &reqwest::Client,
    api: &str,
    email: &str,
    password: &str,
) -> Result<Person, String> {
    let sent = http
        .post(format!("{api}/api/auth/login"))
        // The one header that makes this different from the web app's login.
        // Without it the API sets a cookie and returns the user, exactly as it
        // always has; with it, the session id comes back in the body for a
        // client that has somewhere to keep it. See api/src/auth/auth.controller.ts.
        .header("x-session-return", "1")
        .json(&serde_json::json!({ "email": email, "password": password }))
        .send()
        .await
        .map_err(|e| unreachable(api, &e))?;

    let status = sent.status().as_u16();
    let body = sent.text().await.unwrap_or_default();

    if status == 401 {
        /*
         * A refused password and a console with no accounts on it are the same
         * 401 and are not the same problem, so the app asks which it is before
         * it says anything. `GET /auth/signup` is public and cheap, and
         * getting this wrong is expensive in the way that matters: telling
         * somebody their password is wrong when the truth is that nobody has
         * made them an account sends them off to change a password that was
         * fine.
         */
        return Err(refused(signup_open(http, api).await).into());
    }
    if !(200..300).contains(&status) {
        return Err(complained(status, &body, api));
    }
    serde_json::from_str(&body).map_err(|_| unreadable(api))
}

/// Set this machine up again without asking for a password, using the session
/// this app is already holding.
///
/// The repair path, and the reason the session is kept at all rather than
/// being used once and dropped. A machine whose token was revoked, or whose
/// credential store was cleared, otherwise means typing a password again to
/// fix something the person did not break.
pub async fn enrol(app: &AppHandle) -> Result<Enrolled, String> {
    let session = settings::session();
    if session.is_empty() {
        return Err("This app is not signed in to your console. Sign in above first.".into());
    }

    let api = api(app)?;
    let http = client()?;
    let header = authorization(SCHEME, &session);

    // Who the session belongs to, from the console rather than from anything
    // remembered here: it is also how this finds out the session is still
    // alive before it tries to mint anything with it.
    let sent = http
        .get(format!("{api}/api/auth/me"))
        .header("authorization", &header)
        .send()
        .await
        .map_err(|e| unreachable(&api, &e))?;
    let status = sent.status().as_u16();
    let body = sent.text().await.unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(complained(status, &body, &api));
    }

    let who: Me = serde_json::from_str(&body).map_err(|_| unreadable(&api))?;
    let Some(person) = who.user else {
        return Err(expired().into());
    };

    settings::set_account_email(app, &person.email)?;
    let machine = enrol_as(app, &http, &api, &header, &person.id).await?;
    Ok(Enrolled {
        email: person.email,
        machine: machine.0,
        minted: machine.1,
    })
}

/* ── Enrolling ──────────────────────────────────────────────────────────── */

/// Make sure this computer has a machine on the console, and a token for it.
///
/// Returns the machine's name and whether one had to be minted.
async fn enrol_as(
    app: &AppHandle,
    http: &reqwest::Client,
    api: &str,
    header: &str,
    user_id: &str,
) -> Result<(String, bool), String> {
    let machines = list(http, api, header).await?;

    /*
     * The machine this computer already has, if it still has one.
     *
     * Identified by the id this app was handed when it minted the row, kept in
     * `settings.json` beside the addresses, and checked against what the
     * console currently lists. Not by hostname — two people's laptops are
     * called DESKTOP-something and a person may rename a machine in Settings →
     * Machines, which is a rename this app must not undo — and not by the
     * token alone, because a token whose row was revoked authenticates as
     * nothing and would leave this machine quietly doing no work.
     *
     * Both halves have to be there. The id says which row is ours; the token
     * is the only thing that can actually claim jobs as it, and the console
     * cannot hand it out a second time — it keeps a sha256 and nothing else.
     * So an id with no token beside it is a row nothing can use, and the
     * honest answer is a new one.
     */
    let recorded = settings::machine_id(app);
    let mine: Vec<String> = machines
        .iter()
        .filter(|m| m.user_id == user_id)
        .map(|m| m.id.clone())
        .collect();

    if already_enrolled(&recorded, !settings::token().is_empty(), &mine) {
        let name = machines
            .iter()
            .find(|m| m.id == recorded)
            .map(|m| m.name.clone())
            .unwrap_or_default();
        return Ok((name, false));
    }

    let name = machine_name();
    let minted = mint(http, api, header, &name).await?;
    if minted.token.is_empty() {
        return Err(format!(
            "{api} made a machine for this computer but did not send back its token, so there is \
             nothing for the worker to sign in with. Try again; if it keeps happening, \
             whoever runs the server should look at it."
        ));
    }

    /*
     * The token first, then the id.
     *
     * If the store refuses, this stops with nothing recorded, and the next
     * attempt mints another machine — one stale row somebody can delete. The
     * other order would record an id whose token was never saved, and this app
     * would then believe it was enrolled forever while doing no work at all.
     */
    settings::set_token(&minted.token)?;
    settings::set_machine_id(app, &minted.machine.id)?;
    Ok((minted.machine.name, true))
}

/// Whether this computer may keep the machine it already has.
///
/// Pulled out with no HTTP in it because it is the rule, and the rule is the
/// thing worth testing: a wrong answer here either mints a machine on every
/// sign-in — the console filling up with rows named after one laptop, each
/// with a live token — or keeps one that cannot work.
///
/// `mine` is deliberately only the signed-in person's machines. The console
/// lists everybody's, and a computer handed from one teammate to another must
/// not carry on claiming jobs as the first: their CLI login, their
/// subscription, their name in the picker. Signing in as somebody else on a
/// machine enrolled to a colleague enrols it again, as them.
pub fn already_enrolled(recorded: &str, have_token: bool, mine: &[String]) -> bool {
    !recorded.is_empty() && have_token && mine.iter().any(|id| id == recorded)
}

/// What to call a machine nobody has named yet.
///
/// The hostname, which is what the person will recognise in the picker before
/// anybody has thought of anything better, and it is only ever a *first* name:
/// `registerWorker` on the server does not take a name on conflict, so the
/// moment somebody calls this "Rakib's desktop" in Settings → Machines it stays
/// that, through every re-registration and every re-enrolment.
fn machine_name() -> String {
    for var in ["COMPUTERNAME", "HOSTNAME"] {
        if let Ok(value) = std::env::var(var) {
            let value = value.trim().to_string();
            if !value.is_empty() {
                return value;
            }
        }
    }
    // Windows always sets COMPUTERNAME, and Windows is what this app is built
    // for. Somewhere that sets neither gets something a person can at least
    // recognise as "the one that did not know", and can rename.
    "A teammate's machine".into()
}

/* ── Talking to the API ─────────────────────────────────────────────────── */

#[derive(Deserialize)]
struct Person {
    id: String,
    email: String,
    /// Present only because this app asked for it with `X-Session-Return`.
    session: Option<String>,
    /// The scheme to send it back under, named by the server that issued it so
    /// that this app is not the place the word `Session` is guessed.
    scheme: Option<String>,
}

#[derive(Deserialize)]
struct Me {
    user: Option<Person>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Machine {
    id: String,
    user_id: String,
    name: String,
}

#[derive(Deserialize)]
struct Minted {
    machine: Machine,
    token: String,
}

/// Mint a machine and its token: one row, one credential, handed back once.
async fn mint(
    http: &reqwest::Client,
    api: &str,
    header: &str,
    name: &str,
) -> Result<Minted, String> {
    let sent = http
        .post(format!("{api}/api/machines"))
        .header("authorization", header)
        .json(&serde_json::json!({ "name": name }))
        .send()
        .await
        .map_err(|e| unreachable(api, &e))?;
    let status = sent.status().as_u16();
    let body = sent.text().await.unwrap_or_default();
    if status == 401 {
        return Err(expired().into());
    }
    if !(200..300).contains(&status) {
        return Err(complained(status, &body, api));
    }
    serde_json::from_str(&body).map_err(|_| unreadable(api))
}

async fn list(http: &reqwest::Client, api: &str, header: &str) -> Result<Vec<Machine>, String> {
    let sent = http
        .get(format!("{api}/api/machines"))
        .header("authorization", header)
        .send()
        .await
        .map_err(|e| unreachable(api, &e))?;
    let status = sent.status().as_u16();
    let body = sent.text().await.unwrap_or_default();
    if status == 401 {
        return Err(expired().into());
    }
    if !(200..300).contains(&status) {
        return Err(complained(status, &body, api));
    }
    serde_json::from_str(&body).map_err(|_| unreadable(api))
}

/// Whether this console still has no owner, which is the one time signing up
/// is possible at all.
///
/// A failure to ask is an answer of "closed": the sentence for a closed
/// console is the one that fits an ordinary wrong password, so guessing wrong
/// in that direction only costs a suggestion about invites.
async fn signup_open(http: &reqwest::Client, api: &str) -> bool {
    #[derive(Deserialize)]
    struct Open {
        open: bool,
    }
    match http.get(format!("{api}/api/auth/signup")).send().await {
        Ok(sent) => sent.json::<Open>().await.map(|o| o.open).unwrap_or(false),
        Err(_) => false,
    }
}

fn client() -> Result<reqwest::Client, String> {
    /*
     * The one thing `rustls-no-provider` leaves to the application: which
     * cryptography actually runs. It is not chosen by the dependency so that
     * an app carrying two users of rustls cannot end up with two providers
     * fighting over the process-wide default.
     *
     * Installed here as well as in tauri-plugin-updater — the same call, the
     * same provider, guarded the same way — because whichever happens first
     * has to work: signing in is usually long before anybody clicks Check for
     * updates, and a client built with no provider fails to build at all,
     * which would arrive as "could not open a connection" on a machine whose
     * network is perfect. The `let _` is the second caller finding the first
     * already there, which is the expected outcome, not an error.
     */
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

    reqwest::Client::builder()
        .timeout(TIMEOUT)
        // The console records this against the session and shows it in
        // Settings → Team, so a person looking at their own sessions can tell
        // the desktop app from a browser and end the right one.
        .user_agent(concat!("ContentOS-Desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("This app could not open a connection at all: {e}"))
}

fn api(app: &AppHandle) -> Result<String, String> {
    let api = settings::api_url(app);
    if api.is_empty() {
        return Err(settings::Which::Api.missing().into());
    }
    Ok(api)
}

/// The `Authorization` header value, built in one place.
///
/// The scheme comes from the server that issued the session, but it is checked
/// before it is used: a value with anything odd in it would either be refused
/// by the HTTP client or, in the worst reading, be a way for a response to
/// write a second header. `Session` is what this app expects and what it falls
/// back to.
fn authorization(scheme: &str, session: &str) -> String {
    let scheme = if scheme.chars().all(|c| c.is_ascii_alphabetic()) && !scheme.is_empty() {
        scheme
    } else {
        SCHEME
    };
    format!("{scheme} {session}")
}

/* ── What went wrong, in the app's own words ────────────────────────────── */

/// The console said no to an email and a password.
pub fn refused(signup_open: bool) -> &'static str {
    if signup_open {
        "There are no accounts on this console yet, so there is nothing to sign in to. The very \
         first account — the owner's — is made on the console itself: choose Open the console, \
         sign up there, then come back here and sign in."
    } else {
        "That email and password do not match an account on this console. Accounts here are \
         invite-only, so if you have never signed in before, ask whoever runs the console for an \
         invite link."
    }
}

/// The session this app was holding is not good any more.
fn expired() -> &'static str {
    "Your sign-in on this machine has run out, or somebody signed it out from Settings → Team. \
     Sign in again above."
}

fn unreachable(api: &str, e: &reqwest::Error) -> String {
    /*
     * The API, named, and said to be the API — not the console.
     *
     * They are two hosts on any real deployment, and the person reading this
     * has very often just watched the console window load perfectly, so a
     * sentence about "the server" reads as obviously false and gets dismissed.
     * The address is in it because that is the one fact that turns "it will
     * not connect" into something somebody can check.
     */
    let what = if e.is_timeout() {
        "did not answer in time"
    } else if e.is_connect() {
        "cannot be reached"
    } else {
        "did not answer"
    };
    format!(
        "{api} {what}. That is the API address this machine is set up with — the server the \
         worker asks for jobs, which is not the console. Check that you are online, and that the \
         API address shown above is the one your team uses. ({e})"
    )
}

/// The API answered, and it was not an answer this app can use.
fn unreadable(api: &str) -> String {
    format!(
        "{api} answered with something this app could not read. That address may not be the \
         Content OS API — a console address, or a proxy's error page, both look like this."
    )
}

/// The API refused, and said why in its own words.
///
/// The server's sentence is shown rather than replaced. `ErrorsFilter` on the
/// API writes these for people — "Give the machine a name", "This console is
/// invite-only" — and an app that swallowed them in favour of "something went
/// wrong" would be hiding the only part of the message that says what to do.
fn complained(status: u16, body: &str, api: &str) -> String {
    #[derive(Deserialize)]
    struct Said {
        error: String,
    }
    match serde_json::from_str::<Said>(body) {
        Ok(said) if !said.error.is_empty() => said.error,
        _ => format!("{api} refused this app's request ({status})."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(all: &[&str]) -> Vec<String> {
        all.iter().map(|s| s.to_string()).collect()
    }

    /// The ordinary second sign-in: the machine is there and the token is
    /// here, so nothing is minted. Getting this wrong fills Settings →
    /// Machines with a row per launch, each holding a live credential.
    #[test]
    fn a_machine_that_is_still_listed_is_kept() {
        assert!(already_enrolled(
            "wrk_1",
            true,
            &ids(&["wrk_9", "wrk_1"])
        ));
    }

    /// Revoked in Settings → Machines. The row is gone, so the token in the
    /// store authenticates as nothing, and the honest answer is a new machine
    /// — asked for by somebody who has just proved they are who they say.
    #[test]
    fn a_revoked_machine_is_replaced() {
        assert!(!already_enrolled("wrk_1", true, &ids(&["wrk_9"])));
    }

    /// The row exists and the token does not — a cleared credential store, a
    /// profile restored without it. The console keeps only a sha256 and cannot
    /// hand the token out again, so that row can never work.
    #[test]
    fn a_machine_whose_token_is_gone_is_replaced() {
        assert!(!already_enrolled("wrk_1", false, &ids(&["wrk_1"])));
    }

    /// A computer handed to somebody else. `mine` holds only the signed-in
    /// person's machines, so a row belonging to a colleague is not a row this
    /// sign-in may keep: the jobs it claims would spend their subscription and
    /// carry their name in the picker.
    #[test]
    fn somebody_elses_machine_is_not_reused() {
        assert!(!already_enrolled("wrk_1", true, &ids(&["wrk_2"])));
    }

    #[test]
    fn a_computer_that_has_never_enrolled_mints_one() {
        assert!(!already_enrolled("", true, &ids(&["wrk_1"])));
    }

    /// The two 401s a person can hit, and they must not share a sentence: one
    /// is a password, the other is a console nobody has made an account on.
    #[test]
    fn the_two_refusals_say_different_things() {
        assert!(refused(true).contains("no accounts on this console yet"));
        assert!(refused(false).contains("invite-only"));
    }

    /// The whole conversation, against an API that is actually running.
    ///
    /// Every other test here is a rule with no network in it, which is the
    /// right shape for a rule — and leaves one thing entirely unchecked: that
    /// the `Deserialize` structs above still describe what the server sends.
    /// A field renamed on the API compiles perfectly here and fails on a
    /// teammate's laptop, with a sentence about an address being wrong.
    ///
    /// So this one signs in for real, lists the machines, mints one, and
    /// checks that the reuse rule then recognises it. It skips itself unless
    /// it is told where to go — the same shape as `tests/queue.test.ts`, which
    /// skips when there is no Postgres — because a test that needs a server
    /// must never be the reason `cargo test` is red on a laptop with none:
    ///
    /// ```text
    /// CONTENTOS_TEST_API=http://localhost:4010 \
    /// CONTENTOS_TEST_EMAIL=owner@example.com \
    /// CONTENTOS_TEST_PASSWORD=… \
    ///   cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture enrols_against
    /// ```
    ///
    /// It mints a machine every run, so point it at a throwaway console rather
    /// than at the team's.
    #[test]
    fn signs_in_and_enrols_against_a_real_api() {
        let (Ok(api), Ok(email), Ok(password)) = (
            std::env::var("CONTENTOS_TEST_API"),
            std::env::var("CONTENTOS_TEST_EMAIL"),
            std::env::var("CONTENTOS_TEST_PASSWORD"),
        ) else {
            println!("skipped: CONTENTOS_TEST_API, _EMAIL and _PASSWORD name no console");
            return;
        };

        tauri::async_runtime::block_on(async move {
            let http = client().expect("a client");

            let me = login(&http, &api, &email, &password).await.expect("sign in");
            let session = me
                .session
                .clone()
                .filter(|s| !s.is_empty())
                .expect("the API returned no session — is X-Session-Return read?");
            println!("signed in as {} ({})", me.email, me.id);

            // Sent back the way the app sends it, so this covers the scheme as
            // well as the session: a `Bearer` here would be refused, which is
            // the whole point of the two words being different.
            let header = authorization(me.scheme.as_deref().unwrap_or(SCHEME), &session);

            let before = list(&http, &api, &header).await.expect("list machines");
            let minted = mint(&http, &api, &header, "A test machine")
                .await
                .expect("mint a machine");
            assert!(minted.token.starts_with("wrk_"), "a worker token");
            println!("minted {} \"{}\"", minted.machine.id, minted.machine.name);

            let after = list(&http, &api, &header).await.expect("list again");
            assert_eq!(after.len(), before.len() + 1);
            let mine: Vec<String> = after
                .iter()
                .filter(|m| m.user_id == me.id)
                .map(|m| m.id.clone())
                .collect();
            assert!(already_enrolled(&minted.machine.id, true, &mine));

            // And the password still has to be right, over the same client
            // against the same server — a login that accepts anything would
            // pass every assertion above.
            assert!(login(&http, &api, &email, "not-the-password").await.is_err());
        });
    }

    /// The scheme is the server's word, but only if it is a word.
    #[test]
    fn the_scheme_is_checked_before_it_is_sent() {
        assert_eq!(authorization("Session", "abc"), "Session abc");
        assert_eq!(authorization("", "abc"), "Session abc");
        assert_eq!(authorization("Bad\r\nX-Evil: 1", "abc"), "Session abc");
    }
}
