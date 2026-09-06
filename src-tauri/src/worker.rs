//! The Node worker, running beside the window.
//!
//! This app does not reimplement the worker: `worker/index.ts` already exists,
//! is verified end to end, and is the thing every teammate runs from a
//! terminal today. What is new here is that nobody has to open that terminal —
//! which means every sentence the worker would have printed into one has to
//! arrive somewhere a person can see it, and that is what most of this file
//! is: spawn it, read what it says, and turn that into a state with a name.
//!
//! **It brings its own Node, and its own copy of the worker.** The installer
//! carries a pinned `node.exe` as a Tauri sidecar and `worker/` plus the three
//! `lib/server` files it imports as bundle resources, so a teammate installs
//! one thing and their machine starts taking jobs. "Install Node first" is the
//! exact instruction this app exists to delete, and a runtime the app does not
//! control is also a runtime that can be upgraded out from under it.
//!
//! A checkout still wins when there is one. Running the debug build from
//! inside the repository uses the repository's `worker/` — because that is how
//! anybody debugs this, and a developer editing `worker/index.ts` and watching
//! an installed copy run instead would lose an afternoon to it.
//!
//! Nothing here is persisted. A job this machine was holding when the app
//! quits is not lost: its lease expires on the server, the reaper puts it back
//! in the queue, and another machine takes it — which is why stopping is
//! allowed to be as blunt as killing the process tree.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::settings;
use crate::tray;

/// How much of what the worker said to keep. Enough to cover the last few
/// jobs, short enough that a machine left running for a week is not holding a
/// week of lines in memory.
const LOG_LINES: usize = 200;

/// How long to leave the worker stopped before starting it again. Long enough
/// that a worker failing on every start is visibly stopped rather than
/// invisibly thrashing, short enough that nobody watching decides it is dead.
const RESTART_AFTER: Duration = Duration::from_secs(10);

/// Windows: start the child with no console window of its own. Without this a
/// black box flashes up on every start and, worse, sits in the taskbar looking
/// like something the person is supposed to read.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// What is true about this machine right now.
///
/// The names are the point. Every one of these was a line in a terminal that
/// somebody had to be a developer to read, and the whole reason this app
/// exists is that the people running it are not: "cannot reach the console" is
/// wifi, "token refused" is a trip to Settings → Machines. A single "error"
/// state would put both behind the same shrug.
///
/// `NodeMissing` changed meaning when Node started travelling inside the
/// installer. It used to say "this computer has no Node", which was a download
/// from nodejs.org; now the installer carries one, so it can only mean the
/// installation is damaged — or that somebody is running a checkout without a
/// Node on PATH. Both keep the state, and `start` writes whichever sentence is
/// true, because the actions could not be further apart.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub enum Health {
    #[default]
    NotConfigured,
    Starting,
    Connected,
    Offline,
    NodeMissing,
    NodeTooOld,
    WorkerMissing,
    BadToken,
    Stopped,
}

impl Health {
    /// The CSS class the setup page colours its dot with.
    fn id(self) -> &'static str {
        match self {
            Health::NotConfigured => "not-configured",
            Health::Starting => "starting",
            Health::Connected => "connected",
            Health::Offline => "offline",
            Health::NodeMissing | Health::NodeTooOld => "node-missing",
            Health::WorkerMissing => "worker-missing",
            Health::BadToken => "bad-token",
            Health::Stopped => "stopped",
        }
    }

    /// The short label, which is also the line in the tray menu.
    fn title(self) -> &'static str {
        match self {
            Health::NotConfigured => "Not set up yet",
            Health::Starting => "Starting…",
            Health::Connected => "Connected",
            // The API rather than the console, because that is the host the
            // worker calls and they are two on any real deployment. A person
            // reading this in the tray very often has the console open in the
            // window behind it, and "cannot reach the console" would be a
            // sentence they can see is false.
            Health::Offline => "Cannot reach the server",
            Health::NodeMissing => "This app's copy of Node is missing",
            Health::NodeTooOld => "Node is too old",
            Health::WorkerMissing => "The worker's files are missing",
            Health::BadToken => "This machine's token was refused",
            Health::Stopped => "The worker is not running",
        }
    }
}

/// Everything the setup window draws, in one go.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub state: &'static str,
    pub title: &'static str,
    pub message: String,
    pub console_url: String,
    /// Which of the three places that address came from. The page draws an
    /// address it was given differently from one somebody typed here, and it
    /// cannot tell them apart on its own.
    pub console_source: &'static str,
    /// And the sentence saying so, written where the places are decided rather
    /// than in the page, so that adding a fourth one cannot leave the screen
    /// describing three.
    pub console_source_words: &'static str,
    /// The console address this copy was built with, empty when it was built
    /// with none. Shown only to somebody who has overridden it on this machine
    /// — otherwise an override typed with a typo would hide the correct
    /// address with no way back to it but deleting settings.json.
    pub built_in_console_url: &'static str,
    /// And the same four fields for the API, which is the host the worker
    /// actually calls.
    ///
    /// It is on the screen for one reason, and it is the reason this app has a
    /// screen at all: "my machine will not connect" is answered by knowing
    /// which server it was trying and who told it to try that one. An app that
    /// showed only the console would be showing the address that is working —
    /// the window in front of them is proof of it — and hiding the one that is
    /// not.
    pub api_url: String,
    pub api_source: &'static str,
    pub api_source_words: &'static str,
    pub built_in_api_url: &'static str,
    /// Never the token itself — only whether there is one. The page has no
    /// reason to hold a credential it cannot do anything with, and a webview's
    /// DOM is the last place it should be sitting.
    pub has_token: bool,
    /// Who this app is signed in to the console as, or empty when nobody is.
    ///
    /// The email and never the session, for the same reason as the line above:
    /// the page draws a name, and a credential in the DOM is a credential in
    /// whatever the page ever grows into. `settings::account_email` only
    /// answers while there is a session in the credential store to go with it,
    /// so this cannot say "signed in as Rakib" over a machine that is not.
    pub signed_in_as: String,
    pub log: Vec<String>,
}

#[derive(Default)]
struct Inner {
    /// Bumped every time a child is started or killed, and carried by the
    /// threads reading that child. It is what stops a dying worker's last gasp
    /// from overwriting the status of the one that replaced it — the ordinary
    /// shape of "Restart" is old-child-exits *after* new-child-starts.
    generation: u64,
    pid: Option<u32>,
    health: Health,
    message: String,
    log: VecDeque<String>,
}

#[derive(Clone, Default)]
pub struct Worker {
    inner: Arc<Mutex<Inner>>,
}

impl Worker {
    pub fn view(&self, app: &AppHandle) -> View {
        let inner = self.inner.lock().unwrap();
        let console = settings::address(app, settings::Which::Console);
        let api = settings::address(app, settings::Which::Api);
        View {
            state: inner.health.id(),
            title: inner.health.title(),
            message: inner.message.clone(),
            console_source: console.source.id(),
            console_source_words: console.words(),
            built_in_console_url: console.built_in(),
            console_url: console.url,
            api_source: api.source.id(),
            api_source_words: api.words(),
            built_in_api_url: api.built_in(),
            api_url: api.url,
            has_token: !settings::token().is_empty(),
            signed_in_as: settings::account_email(app),
            log: inner.log.iter().cloned().collect(),
        }
    }

    /// Whether the worker could not even be started, so this machine will do
    /// nothing at all until somebody sees the reason and acts on it.
    ///
    /// Deliberately not every unhappy state: a worker that is running but
    /// cannot reach the console is retrying and will very likely fix itself
    /// when the wifi comes back, and a window that shoves itself in front of
    /// somebody every time a train goes through a tunnel is a window they
    /// learn to dismiss without reading.
    pub fn stuck(&self) -> bool {
        matches!(
            self.inner.lock().unwrap().health,
            Health::NotConfigured
                | Health::NodeMissing
                | Health::NodeTooOld
                | Health::WorkerMissing
                | Health::Stopped
        )
    }

    /// Start the worker, replacing whatever was running.
    pub fn start(&self, app: &AppHandle) {
        self.halt();

        let console = settings::console_url(app);
        let api = settings::api_url(app);
        let token = settings::token();
        if console.is_empty() || api.is_empty() || token.is_empty() {
            /*
             * Five sentences rather than one, because they are five different
             * things to go and do — and because a teammate with an installer
             * that knows where both servers are has exactly one of them left,
             * and asking them for an address the app already has would send
             * them to find out something nobody needs them to know.
             *
             * The API gets its own sentence for the case that will actually
             * happen: an installer built before this app knew about a second
             * address, or built by somebody who set only the first. That copy
             * has a console and no API, and "fill in the address" would send
             * its owner to check the one that is already right.
             *
             * The last two are the ordinary first run, and they are two
             * because a person who has already signed in must not be told to
             * sign in. Signing in is what mints this machine's token now, so
             * "no token" nearly always means "has not signed in yet"; when it
             * does not — a store that was cleared, a machine revoked — the
             * thing to do is the one-click repair, not a password.
             */
            let signed_in = !settings::account_email(app).is_empty();
            return self.set(
                app,
                Health::NotConfigured,
                match (console.is_empty(), api.is_empty()) {
                    (true, true) => {
                        "Fill in the console and API addresses below, then sign in with your email \
                         and password."
                    }
                    (true, false) => {
                        "Fill in the console address below, then sign in with your email and \
                         password."
                    }
                    (false, true) => {
                        "This copy knows the console but not the API — the server the worker asks \
                         for jobs, which is a different host. Fill it in below, then sign in."
                    }
                    (false, false) if signed_in => {
                        "This app is signed in, but this machine has no worker token of its own. \
                         Choose Set this machine up again below and it will get one."
                    }
                    (false, false) => {
                        "Sign in below with the email and password you use for Content OS. This \
                         app will set this machine up itself — there is nothing to paste."
                    }
                },
            );
        }

        let layout = match Layout::find(app) {
            Ok(layout) => layout,
            Err((health, why)) => return self.set(app, health, why),
        };

        /*
         * Started exactly the way `npm run worker` starts it — the same flag,
         * the same loader hook, the same relative path from the same working
         * directory. Anything cleverer here becomes a second way to run the
         * worker that has to be kept in step with package.json, and the day
         * they drift is the day this app runs a worker nobody can reproduce
         * from a terminal.
         *
         * The only difference an installed app makes is *which* Node and
         * *which* copy of `worker/`, and both are decided in `Layout::find`.
         */
        let mut cmd = Command::new(&layout.node);
        cmd.current_dir(&layout.root)
            .arg("--disable-warning=MODULE_TYPELESS_PACKAGE_JSON")
            .arg("--import")
            .arg("./worker/register.mjs")
            .arg("worker/index.ts")
            .env("CONTENTOS_WORKER_TOKEN", &token)
            /*
             * The API's address, and never the console's.
             *
             * They are two hosts on every real deployment — `docs/DEPLOYING.md`
             * puts the web app on APP_HOST and NestJS on API_HOST, and there is
             * no `/api` under Next — so a worker handed the console's origin
             * would 404 on everything while the window beside it worked
             * perfectly, which is the failure that is hardest to report. A
             * checkout is the same shape at :3333 and :4000, see
             * `lib/api-base.ts`.
             *
             * An inherited `CONTENTOS_API_URL` still wins, and no longer needs
             * a check of its own for it to: it is the first place
             * `settings::api_url` looks, so this is the same value the child
             * would have inherited, tidied. That check moved into `pick`
             * rather than being deleted — one rule, in the one place, for both
             * addresses.
             */
            .env("CONTENTOS_API_URL", &api)
            // Nothing is ever asked of this process on stdin, and a child that
            // inherits a console's stdin can block on it forever.
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        layout.give_it_somewhere_to_write(app, &mut cmd);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                /*
                 * Only reachable from a checkout: an installed app has already
                 * been told in `Layout::find` that its own `node.exe` is not
                 * there. This is the developer case, and it deserves the
                 * developer's sentence rather than "reinstall".
                 */
                return self.set(
                    app,
                    Health::NodeMissing,
                    "This is a checkout of Content OS rather than an installed copy, so it has no Node of \
                     its own and there is none on this computer either. Install Node 22.18 or newer from \
                     nodejs.org, then choose Restart the worker.",
                );
            }
            Err(e) => {
                return self.set(
                    app,
                    Health::Stopped,
                    format!("The worker would not start: {e}"),
                );
            }
        };

        let out = child.stdout.take();
        let err = child.stderr.take();
        let generation = {
            let mut inner = self.inner.lock().unwrap();
            inner.generation += 1;
            inner.pid = Some(child.id());
            inner.health = Health::Starting;
            // The API, because that is the host this process is about to
            // start calling and therefore the one a failure in the next few
            // seconds will be about.
            inner.message = format!("Starting the worker, which calls {api}.");
            inner.generation
        };
        self.announce(app);

        if let Some(out) = out {
            self.read(app, generation, out);
        }
        if let Some(err) = err {
            self.read(app, generation, err);
        }

        // One thread whose whole job is to notice the death. `wait()` blocks
        // it and nothing else — the child is owned here, not behind the mutex,
        // so a kill from any other thread is never waiting on this one.
        let me = self.clone();
        let app = app.clone();
        thread::spawn(move || {
            let status = child.wait();
            me.exited(&app, generation, status);
        });
    }

    /// Stop the worker and say so.
    pub fn stop(&self, app: &AppHandle) {
        self.halt();
        self.set(
            app,
            Health::Stopped,
            "The worker is not running, so this machine is not taking any jobs.",
        );
    }

    /// Kill the child and everything under it, without a word.
    ///
    /// Bumping the generation *before* the kill is what makes the death
    /// silent: the supervisor thread wakes, finds itself out of date, and says
    /// nothing, so a restart does not flash "the worker stopped" at somebody
    /// who just asked for it to start.
    fn halt(&self) {
        let pid = {
            let mut inner = self.inner.lock().unwrap();
            inner.generation += 1;
            inner.pid.take()
        };
        if let Some(pid) = pid {
            kill_tree(pid);
        }
    }

    /// One line out of the worker's mouth.
    fn say(&self, app: &AppHandle, generation: u64, line: String) {
        {
            let mut inner = self.inner.lock().unwrap();
            if inner.generation != generation {
                return;
            }
            if inner.log.len() >= LOG_LINES {
                inner.log.pop_front();
            }
            inner.log.push_back(line.clone());
            if let Some((health, message)) = classify(&line) {
                inner.health = health;
                inner.message = message;
            }
        }
        self.announce(app);
    }

    /// The child is gone. Decide whether that is the end of it.
    fn exited(&self, app: &AppHandle, generation: u64, status: std::io::Result<ExitStatus>) {
        let ending = {
            let mut inner = self.inner.lock().unwrap();
            if inner.generation != generation {
                // Somebody has already replaced this child. Its death is old news.
                return;
            }
            inner.pid = None;
            match inner.health {
                /*
                 * The worker exits 1 on purpose for these two, having already
                 * printed the sentence that explains them, and starting it
                 * again would only reprint it every ten seconds. They are the
                 * two states that need a person, so they keep their words and
                 * wait for one.
                 */
                Health::BadToken | Health::NodeTooOld => None,
                _ => Some(match status {
                    Ok(status) => match status.code() {
                        Some(code) => format!(
                            "The worker stopped on its own (exit {code}). Starting it again in {} seconds.",
                            RESTART_AFTER.as_secs()
                        ),
                        None => "The worker was stopped from outside this app. Starting it again.".to_string(),
                    },
                    Err(e) => format!("Lost track of the worker: {e}. Starting it again."),
                }),
            }
        };
        let Some(message) = ending else {
            return self.announce(app);
        };
        self.set(app, Health::Stopped, message);

        /*
         * And then start it again.
         *
         * This app is the thing that keeps the worker running, so a worker
         * that ends for a reason nobody has to act on has to be started again
         * by something — otherwise the first laptop whose wifi arrives thirty
         * seconds after the login screen sits there doing nothing until
         * somebody thinks to open a menu, which is the state this whole app
         * exists to abolish.
         *
         * It is worth knowing WHY that case is not theoretical. `sleep()` in
         * worker/index.ts unrefs its timer, so when the console cannot be
         * reached during the first registration there is nothing ref'd left in
         * Node's event loop and the process exits 0 — having just printed
         * "Trying again in 10s", which it then does not do. After registration
         * the heartbeat and re-register intervals hold the loop open and the
         * worker retries properly, so this is specifically the
         * console-was-not-there-yet case, and it is exactly the case a desktop
         * app is for.
         *
         * The wait is what keeps a genuinely broken worker from becoming a
         * process started forty times a minute, and the generation check is
         * what keeps this from resurrecting a worker somebody has since
         * stopped or replaced.
         */
        let me = self.clone();
        let app = app.clone();
        thread::spawn(move || {
            thread::sleep(RESTART_AFTER);
            if me.inner.lock().unwrap().generation == generation {
                me.start(&app);
            }
        });
    }

    fn set(&self, app: &AppHandle, health: Health, message: impl Into<String>) {
        {
            let mut inner = self.inner.lock().unwrap();
            inner.health = health;
            inner.message = message.into();
        }
        self.announce(app);
    }

    /// Put the current state everywhere a person might be looking: the tray
    /// menu, which is all there is when the window is closed, and the setup
    /// window, which is where the sentence explaining it lives.
    fn announce(&self, app: &AppHandle) {
        let view = self.view(app);
        tray::say(app, &view);
        let _ = app.emit("worker-status", view);
    }

    /// Read one of the child's pipes, a line at a time, for as long as it is open.
    fn read<R: Read + Send + 'static>(&self, app: &AppHandle, generation: u64, pipe: R) {
        let me = self.clone();
        let app = app.clone();
        thread::spawn(move || {
            for line in BufReader::new(pipe).lines() {
                let Ok(line) = line else { break };
                me.say(&app, generation, line);
            }
        });
    }
}

/// What the worker's own words mean for the person watching.
///
/// Matching on sentences rather than on a machine-readable protocol is a
/// deliberate trade: the worker's job is to be readable in a terminal, and
/// giving it a second, structured output stream to serve this app would mean
/// two things to keep in step. These are matched on the stable middles of
/// lines in `worker/index.ts`, and anything unrecognised is still shown
/// verbatim in the window — an unknown line is never swallowed.
fn classify(line: &str) -> Option<(Health, String)> {
    if line.contains("Registered as ") {
        return Some((
            Health::Connected,
            "This machine is signed in to the console and waiting for work.".into(),
        ));
    }
    if line.contains("Claimed ") {
        return Some((Health::Connected, "Running a job.".into()));
    }
    if line.contains("Finished ") || line.contains("Failed ") || line.contains("Handed back ") {
        return Some((Health::Connected, "Waiting for work.".into()));
    }
    if line.contains("Cannot reach ") || line.contains("No answer from ") {
        return Some((
            Health::Offline,
            "The server this machine's worker calls is not answering. This is usually the network; it keeps \
             trying, and nothing is lost. The address it is calling is shown above."
                .into(),
        ));
    }
    if line.contains("did not recognise CONTENTOS_WORKER_TOKEN") {
        return Some((
            Health::BadToken,
            /*
             * This used to be a trip to Settings → Machines on a web console
             * to mint a token and paste it back. There may not be a console to
             * go to — the deployment this is heading for is the API alone —
             * and there does not need to be: this app can mint a new one for
             * itself from the sign-in it already holds, which is one button.
             */
            "The console does not recognise this machine's token — it was probably revoked in \
             Settings → Machines. Choose Set this machine up again below and this app will get a \
             new one. If it asks you to sign in first, sign in."
                .into(),
        ));
    }
    if line.contains("Unknown file extension") || line.contains("ERR_UNKNOWN_FILE_EXTENSION") {
        /*
         * Node is there but predates type stripping, so it will not run the
         * worker's .ts files. It looks like a crash and is a version number;
         * see worker/resolve-ts.mjs for why 22.18 is the floor.
         *
         * Only a checkout can reach this now — the Node inside the installer
         * is pinned well above the floor by src-tauri/scripts/fetch-node.mjs —
         * so the advice is a developer's, and the state stays separate from
         * "missing" because the fix is an upgrade rather than an install.
         */
        return Some((
            Health::NodeTooOld,
            "The Node this checkout is using is too old to run the worker. Install Node 22.18 or newer \
             from nodejs.org, then choose Restart the worker."
                .into(),
        ));
    }
    None
}

/// Which Node runs which copy of the worker, and where it may write.
///
/// Two shapes, and they are not variations of one another:
///
/// - **Installed.** Everything came out of the installer. `worker/` and the
///   three `lib/server` files it imports are under Tauri's resource directory,
///   and a pinned `node.exe` sits beside the app's own executable as a
///   sidecar. Nothing is required of the computer.
/// - **A checkout.** `worker/` is the repository's, which is the copy somebody
///   is editing, and the Node is whatever they have. This is how the app is
///   debugged, and it has to keep working or a fix would have to be installed
///   to be tried.
struct Layout {
    /// The folder with `worker/` in it. Also the child's working directory,
    /// because that is where `npm run worker` starts from.
    root: PathBuf,
    /// The program to run: an absolute path to the app's own Node when there
    /// is one, and otherwise the bare name, which means PATH.
    node: PathBuf,
    /// Whether `root` came out of the installer. It decides one thing — where
    /// the worker is allowed to write — and nothing else.
    installed: bool,
}

impl Layout {
    fn find(app: &AppHandle) -> Result<Self, (Health, String)> {
        let (root, installed) = worker_root(app).ok_or_else(|| {
            (
                Health::WorkerMissing,
                "This app cannot find worker/index.ts. An installed copy carries its own, so if this one \
                 is damaged, install Content OS again. Running from a checkout it looks for the Content OS \
                 folder around itself — set CONTENTOS_WORKER_DIR to that folder if it is somewhere else."
                    .to_string(),
            )
        })?;

        /*
         * The app's own Node wherever there is one, including in a checkout:
         * it is the version this worker is pinned to, fetched and checksummed
         * by src-tauri/scripts/fetch-node.mjs, and a debug session that runs
         * the same runtime as the installed app is a debug session whose
         * findings transfer.
         */
        let node = match shipped_node() {
            Some(node) => node,
            None if installed => {
                return Err((
                    Health::NodeMissing,
                    "Content OS installs its own copy of Node and that copy is not here, so this \
                     installation is damaged — nothing is missing from your computer. Install Content OS \
                     again over the top of this one; both addresses and this machine's token are kept."
                        .to_string(),
                ))
            }
            None => PathBuf::from("node"),
        };

        Ok(Layout {
            root,
            node,
            installed,
        })
    }

    /// Give the worker somewhere it is allowed to write.
    ///
    /// This is not a nicety, it is the difference between an installed app
    /// that works and one that fails its first job. `cliHome()` in
    /// `lib/server/tools.ts` does a `mkdirSync` under `CONTENTOS_DATA_DIR`, or
    /// under the working directory when that is unset — and an installed app's
    /// working directory is inside Program Files, where a normal user account
    /// cannot create anything. The failure would land on the machine where
    /// nobody is reading a terminal.
    ///
    /// A checkout is deliberately left alone. `.data/` beside `worker/` is
    /// what `npm run worker` uses and what `npm run worker:setup` fills, and an
    /// app quietly preferring a different folder would make a bug seen here
    /// impossible to reproduce there.
    ///
    /// An explicit setting always wins, for the same reason it does in
    /// `worker/config.ts`: somebody put a three-gigabyte whisper model on the
    /// drive with room for it.
    fn give_it_somewhere_to_write(&self, app: &AppHandle, cmd: &mut Command) {
        if !self.installed {
            return;
        }
        let Ok(dir) = app.path().app_data_dir() else {
            return;
        };
        // Two variables rather than one, because they mean different things:
        // the first is where `cliHome()` makes the deliberately empty folder
        // the model CLIs are started in, the second is where the tools
        // installer puts yt-dlp, ffmpeg and whisper.cpp.
        for (name, value) in [
            ("CONTENTOS_DATA_DIR", dir.join("data")),
            ("CONTENTOS_TOOLS_DIR", dir.join("tools")),
        ] {
            if std::env::var_os(name).is_none() {
                cmd.env(name, value);
            }
        }
    }
}

/// The Content OS folder — the one with `worker/` in it — and whether it came
/// out of the installer.
///
/// Searched for rather than configured, because in development this app is
/// started from `src-tauri` and the worker is two directories up, and asking
/// somebody to set a path to a folder that is already right there is the kind
/// of setup step that makes a tool feel broken before it has run once.
///
/// The resource directory is tried before the walk upwards, and on Windows
/// that ordering is load-bearing rather than tidy: an installed app's
/// executable lives *in* its resource directory, so the walk would find the
/// same folder a step later and call it a checkout, and the worker would then
/// be pointed at Program Files to write in.
fn worker_root(app: &AppHandle) -> Option<(PathBuf, bool)> {
    let mut tried: Vec<(PathBuf, bool)> = Vec::new();
    if let Ok(set) = std::env::var("CONTENTOS_WORKER_DIR") {
        tried.push((PathBuf::from(set), false));
    }
    if let Ok(resources) = app.path().resource_dir() {
        tried.push((resources, true));
    }
    if let Ok(exe) = std::env::current_exe() {
        tried.extend(exe.ancestors().map(|p| (p.to_path_buf(), false)));
    }
    if let Ok(cwd) = std::env::current_dir() {
        tried.extend(cwd.ancestors().map(|p| (p.to_path_buf(), false)));
    }
    tried.into_iter().find(|(root, _)| {
        root.join("worker").join("index.ts").is_file()
            && root.join("worker").join("register.mjs").is_file()
    })
}

/// The Node that came out of the installer, if it is there.
///
/// Tauri puts an `externalBin` next to the app's own executable and takes the
/// target triple back off the name, so this is one `is_file` on a path that is
/// known rather than a search. Absolute on purpose: the entire point of
/// shipping a runtime is not to depend on what PATH happens to say.
fn shipped_node() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let node = exe.with_file_name(if cfg!(windows) { "node.exe" } else { "node" });
    node.is_file().then_some(node)
}

/// Kill the worker and everything it started.
///
/// The child that outlives its window is the bug that makes people restart
/// Windows, and here it would be worse than an idle process: an orphaned
/// worker keeps claiming jobs from a console the person thinks they have
/// closed, spends their model subscription on them, and cannot be stopped from
/// anywhere they can see.
///
/// It has to be the whole tree. `worker/index.ts` runs each job in a process
/// of its own, and those spawn the model CLIs through a shell, so killing only
/// the process this app started would leave `claude` running with nobody
/// waiting for it. `taskkill /T` walks the tree; this mirrors `killTree` in
/// `worker/index.ts` for exactly the same reason.
///
/// Blocking on the kill matters: the last caller is the app on its way out,
/// and returning before the kill has been issued is the same as not issuing it.
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/pid", &pid.to_string(), "/t", "/f"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
}
