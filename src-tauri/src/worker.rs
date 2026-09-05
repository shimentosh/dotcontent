//! The Node worker, running beside the window.
//!
//! This app does not reimplement the worker: `worker/index.ts` already exists,
//! is verified end to end, and is the thing every teammate runs from a
//! terminal today. What is new here is that nobody has to open that terminal —
//! which means every sentence the worker would have printed into one has to
//! arrive somewhere a person can see it, and that is what most of this file
//! is: spawn it, read what it says, and turn that into a state with a name.
//!
//! **It spawns the Node that is already on the machine.** Bundling a Node
//! runtime as a Tauri sidecar is the next step and not this one; what makes
//! that acceptable now is that Node's absence is *detected and named* rather
//! than being a process that silently never started.
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
/// wifi, "token refused" is a trip to Settings → Machines, and "Node missing"
/// is one download. A single "error" state would put all three behind the same
/// shrug.
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
            Health::Offline => "Cannot reach the console",
            Health::NodeMissing => "Node is not installed",
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
    /// Never the token itself — only whether there is one. The page has no
    /// reason to hold a credential it cannot do anything with, and a webview's
    /// DOM is the last place it should be sitting.
    pub has_token: bool,
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
        View {
            state: inner.health.id(),
            title: inner.health.title(),
            message: inner.message.clone(),
            console_url: settings::console_url(app),
            has_token: !settings::token().is_empty(),
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

        let url = settings::console_url(app);
        let token = settings::token();
        if url.is_empty() || token.is_empty() {
            return self.set(
                app,
                Health::NotConfigured,
                "Fill in the console address and this machine's token below, then choose Save and start.",
            );
        }

        let Some(root) = worker_root(app) else {
            return self.set(
                app,
                Health::WorkerMissing,
                "This app cannot find worker/index.ts. It looks for the Content OS folder around itself; \
                 set CONTENTOS_WORKER_DIR to that folder if it is somewhere else.",
            );
        };

        /*
         * Started exactly the way `npm run worker` starts it — the same flag,
         * the same loader hook, the same relative path from the same working
         * directory. Anything cleverer here becomes a second way to run the
         * worker that has to be kept in step with package.json, and the day
         * they drift is the day this app runs a worker nobody can reproduce
         * from a terminal.
         */
        let mut cmd = Command::new("node");
        cmd.current_dir(&root)
            .arg("--disable-warning=MODULE_TYPELESS_PACKAGE_JSON")
            .arg("--import")
            .arg("./worker/register.mjs")
            .arg("worker/index.ts")
            .env("CONTENTOS_API_URL", &url)
            .env("CONTENTOS_WORKER_TOKEN", &token)
            // Nothing is ever asked of this process on stdin, and a child that
            // inherits a console's stdin can block on it forever.
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                /*
                 * The one failure a non-developer is guaranteed to hit, and
                 * the one that must never be silent. Naming the program and
                 * where to get it is the difference between a person fixing
                 * their own machine in five minutes and a message to whoever
                 * set up the server.
                 */
                return self.set(
                    app,
                    Health::NodeMissing,
                    "The worker needs Node on this computer and there is none. Install Node 22.18 or newer \
                     from nodejs.org — take the default options — then choose Restart the worker.",
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
            inner.message = format!("Starting the worker for {url}.");
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
            "The console is not answering. This is usually the network; it keeps trying, and nothing is lost."
                .into(),
        ));
    }
    if line.contains("did not recognise CONTENTOS_WORKER_TOKEN") {
        return Some((
            Health::BadToken,
            "The console does not recognise this machine's token. On the console, go to Settings → Machines, \
             add this machine again, and paste the new token below."
                .into(),
        ));
    }
    if line.contains("Unknown file extension") || line.contains("ERR_UNKNOWN_FILE_EXTENSION") {
        /*
         * Node is installed but predates type stripping, so it will not run
         * the worker's .ts files. It looks like a crash and is a version
         * number; see worker/resolve-ts.mjs for why 22.18 is the floor.
         */
        return Some((
            Health::NodeTooOld,
            "The Node on this computer is too old to run the worker. Install Node 22.18 or newer from \
             nodejs.org, then choose Restart the worker."
                .into(),
        ));
    }
    None
}

/// The Content OS folder — the one with `worker/` in it.
///
/// Searched for rather than configured, because in development this app is
/// started from `src-tauri` and the worker is two directories up, and asking
/// somebody to set a path to a folder that is already right there is the kind
/// of setup step that makes a tool feel broken before it has run once.
///
/// The resource directory is tried first among the automatic candidates
/// because that is where an installed build will keep its copy the day the
/// worker is bundled; today it simply is not there and the walk upwards wins.
fn worker_root(app: &AppHandle) -> Option<PathBuf> {
    let mut tried: Vec<PathBuf> = Vec::new();
    if let Ok(set) = std::env::var("CONTENTOS_WORKER_DIR") {
        tried.push(PathBuf::from(set));
    }
    if let Ok(resources) = app.path().resource_dir() {
        tried.push(resources);
    }
    if let Ok(exe) = std::env::current_exe() {
        tried.extend(exe.ancestors().map(PathBuf::from));
    }
    if let Ok(cwd) = std::env::current_dir() {
        tried.extend(cwd.ancestors().map(PathBuf::from));
    }
    tried.into_iter().find(|root| {
        root.join("worker").join("index.ts").is_file()
            && root.join("worker").join("register.mjs").is_file()
    })
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
