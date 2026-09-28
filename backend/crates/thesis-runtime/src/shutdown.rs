//! Process-wide admission and shutdown state machine.
//!
//! Shutdown is modeled separately from queue occupancy and individual job
//! cancellation.  A controller can therefore stop admissions, ask workers to
//! cancel pending work, and finally stop transport ownership without smuggling
//! side effects into a reducer.

use core::fmt;

/// Shutdown phase visible to admission and worker orchestration.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ShutdownPhase {
    /// New work may be admitted and existing work may run.
    Running,
    /// New work is rejected; existing work may finish.
    Draining,
    /// New work is rejected and pending jobs should be cancelled.
    Cancelling,
    /// No further work or transitions are required.
    Stopped,
}

impl ShutdownPhase {
    pub const fn accepts_new_work(self) -> bool {
        matches!(self, Self::Running)
    }

    pub const fn permits_existing_work(self) -> bool {
        matches!(self, Self::Running | Self::Draining)
    }

    pub const fn cancellation_requested(self) -> bool {
        matches!(self, Self::Cancelling | Self::Stopped)
    }
}

/// A pure shutdown command.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ShutdownCommand {
    /// Stop admission while allowing already-running work to finish.
    BeginDrain,
    /// Escalate to cancellation of queued and running work.
    CancelPending,
    /// Stop the runtime immediately after callers apply their cancellation policy.
    Stop,
}

/// Whether a shutdown command changed state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ShutdownDisposition {
    Applied,
    Noop,
}

/// Before/after view of one shutdown reduction.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ShutdownTransition {
    previous: ShutdownPhase,
    current: ShutdownPhase,
    disposition: ShutdownDisposition,
}

impl ShutdownTransition {
    pub const fn previous(self) -> ShutdownPhase {
        self.previous
    }

    pub const fn current(self) -> ShutdownPhase {
        self.current
    }

    pub const fn disposition(self) -> ShutdownDisposition {
        self.disposition
    }
}

/// Why a shutdown command was rejected.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ShutdownError {
    InvalidTransition {
        phase: ShutdownPhase,
        command: ShutdownCommand,
    },
}

impl fmt::Display for ShutdownError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidTransition { phase, command } => {
                write!(
                    formatter,
                    "cannot apply {command:?} while shutdown is {phase:?}"
                )
            }
        }
    }
}

/// Deterministic process shutdown state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ShutdownController {
    phase: ShutdownPhase,
}

impl Default for ShutdownController {
    fn default() -> Self {
        Self::new()
    }
}

impl ShutdownController {
    pub const fn new() -> Self {
        Self {
            phase: ShutdownPhase::Running,
        }
    }

    pub const fn phase(self) -> ShutdownPhase {
        self.phase
    }

    pub const fn accepts_new_work(self) -> bool {
        self.phase.accepts_new_work()
    }

    pub const fn permits_existing_work(self) -> bool {
        self.phase.permits_existing_work()
    }

    pub const fn cancellation_requested(self) -> bool {
        self.phase.cancellation_requested()
    }

    /// Apply one shutdown transition.
    pub fn apply(&mut self, command: ShutdownCommand) -> Result<ShutdownTransition, ShutdownError> {
        let previous = self.phase;
        let (current, disposition) = match (self.phase, command) {
            (ShutdownPhase::Running, ShutdownCommand::BeginDrain) => {
                (ShutdownPhase::Draining, ShutdownDisposition::Applied)
            }
            (ShutdownPhase::Running, ShutdownCommand::CancelPending)
            | (ShutdownPhase::Draining, ShutdownCommand::CancelPending) => {
                (ShutdownPhase::Cancelling, ShutdownDisposition::Applied)
            }
            (ShutdownPhase::Running, ShutdownCommand::Stop)
            | (ShutdownPhase::Draining, ShutdownCommand::Stop)
            | (ShutdownPhase::Cancelling, ShutdownCommand::Stop) => {
                (ShutdownPhase::Stopped, ShutdownDisposition::Applied)
            }
            (ShutdownPhase::Draining, ShutdownCommand::BeginDrain)
            | (ShutdownPhase::Cancelling, ShutdownCommand::CancelPending)
            | (ShutdownPhase::Stopped, _) => (self.phase, ShutdownDisposition::Noop),
            (phase, command) => {
                return Err(ShutdownError::InvalidTransition { phase, command });
            }
        };
        self.phase = current;
        Ok(ShutdownTransition {
            previous,
            current,
            disposition,
        })
    }

    pub fn begin_drain(&mut self) -> Result<ShutdownTransition, ShutdownError> {
        self.apply(ShutdownCommand::BeginDrain)
    }

    pub fn cancel_pending(&mut self) -> Result<ShutdownTransition, ShutdownError> {
        self.apply(ShutdownCommand::CancelPending)
    }

    pub fn stop(&mut self) -> Result<ShutdownTransition, ShutdownError> {
        self.apply(ShutdownCommand::Stop)
    }
}

#[cfg(test)]
mod tests {
    use super::{ShutdownCommand, ShutdownController, ShutdownDisposition, ShutdownPhase};

    #[test]
    fn drain_rejects_admission_but_preserves_running_work() {
        let mut controller = ShutdownController::new();
        let transition = controller.begin_drain().expect("begin drain");
        assert_eq!(transition.current(), ShutdownPhase::Draining);
        assert_eq!(transition.disposition(), ShutdownDisposition::Applied);
        assert!(!controller.accepts_new_work());
        assert!(controller.permits_existing_work());
    }

    #[test]
    fn stop_is_idempotent_after_cancellation() {
        let mut controller = ShutdownController::new();
        controller
            .apply(ShutdownCommand::CancelPending)
            .expect("cancel pending");
        controller.stop().expect("stop");
        let transition = controller.stop().expect("repeat stop");
        assert_eq!(transition.disposition(), ShutdownDisposition::Noop);
        assert_eq!(controller.phase(), ShutdownPhase::Stopped);
        assert!(controller.cancellation_requested());
    }
}

#[cfg(test)]
mod property_tests {
    use super::{ShutdownCommand, ShutdownController, ShutdownPhase};
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn shutdown_never_reopens_admission(commands in prop::collection::vec(any::<u8>(), 0..128)) {
            let mut controller = ShutdownController::new();
            for command in commands {
                let command = match command % 3 {
                    0 => ShutdownCommand::BeginDrain,
                    1 => ShutdownCommand::CancelPending,
                    _ => ShutdownCommand::Stop,
                };
                let _ = controller.apply(command);
                prop_assert!(!matches!(controller.phase(), ShutdownPhase::Running) || controller.accepts_new_work());
                if controller.phase() != ShutdownPhase::Running {
                    prop_assert!(!controller.accepts_new_work());
                }
            }
        }
    }
}

#[cfg(kani)]
mod verification {
    use super::{ShutdownCommand, ShutdownController, ShutdownPhase};

    #[kani::proof]
    fn shutdown_commands_never_reopen_admission() {
        let mut controller = ShutdownController::new();
        let command: u8 = kani::any();
        let command = match command % 3 {
            0 => ShutdownCommand::BeginDrain,
            1 => ShutdownCommand::CancelPending,
            _ => ShutdownCommand::Stop,
        };
        let _ = controller.apply(command);
        if controller.phase() != ShutdownPhase::Running {
            assert!(!controller.accepts_new_work());
        }
    }
}
