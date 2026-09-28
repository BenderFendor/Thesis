//! Fenced job lifecycle state machines.
//!
//! A [`JobRecord`] accepts commands only for its current generation.  A
//! retry/restart advances the generation before returning to `Queued`, so a
//! late worker result from the previous attempt cannot mutate the new attempt.
//! Terminal transitions produce one event and all later terminal commands are
//! rejected without producing another event.

use core::fmt;

/// Stable identity for a runtime job.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct JobId(u64);

impl JobId {
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    pub const fn value(self) -> u64 {
        self.0
    }
}

impl fmt::Display for JobId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Monotonic attempt generation for a job or cache stream.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct Generation(u64);

impl Generation {
    pub const INITIAL: Self = Self(0);

    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    pub const fn value(self) -> u64 {
        self.0
    }

    pub const fn next(self) -> Option<Self> {
        match self.0.checked_add(1) {
            Some(value) => Some(Self(value)),
            None => None,
        }
    }
}

impl fmt::Display for Generation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// A generation mismatch rejected before a command can mutate state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GenerationMismatch {
    expected: Generation,
    received: Generation,
}

impl GenerationMismatch {
    pub const fn expected(self) -> Generation {
        self.expected
    }

    pub const fn received(self) -> Generation {
        self.received
    }
}

impl fmt::Display for GenerationMismatch {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "stale generation: expected {}, received {}",
            self.expected, self.received
        )
    }
}

/// A reusable fence for any generation-scoped stream or cache.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GenerationFence {
    current: Generation,
}

impl GenerationFence {
    pub const fn new(initial: Generation) -> Self {
        Self { current: initial }
    }

    pub const fn current(self) -> Generation {
        self.current
    }

    pub const fn accepts(self, generation: Generation) -> bool {
        self.current.value() == generation.value()
    }

    pub const fn check(self, generation: Generation) -> Result<(), GenerationMismatch> {
        if self.current.value() == generation.value() {
            Ok(())
        } else {
            Err(GenerationMismatch {
                expected: self.current,
                received: generation,
            })
        }
    }

    pub fn advance(&mut self) -> Result<Generation, GenerationError> {
        let next = self.current.next().ok_or(GenerationError::Exhausted)?;
        self.current = next;
        Ok(next)
    }
}

/// Why a generation cannot be advanced again.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GenerationError {
    Exhausted,
}

impl fmt::Display for GenerationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Exhausted => formatter.write_str("generation number exhausted"),
        }
    }
}

/// The pure lifecycle phase of a job.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JobPhase {
    Queued,
    Running,
    Cancelling,
    Succeeded,
    Failed,
    Cancelled,
}

impl JobPhase {
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Cancelled)
    }
}

/// Reason recorded when cancellation becomes terminal.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CancellationReason {
    Requested,
    Shutdown,
}

/// Terminal status retained by the reducer without owning a result payload.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TerminalStatus {
    Succeeded,
    Failed,
    Cancelled(CancellationReason),
}

/// Command variants, without a generation wrapper, for diagnostics.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JobActionKind {
    Start,
    RequestCancel,
    AcknowledgeCancellation,
    ForceCancel,
    Complete,
}

/// A worker or controller command for one job attempt.
#[derive(Debug, Eq, PartialEq)]
pub enum JobCommand<R, E> {
    Start,
    RequestCancel { reason: CancellationReason },
    AcknowledgeCancellation,
    ForceCancel { reason: CancellationReason },
    Complete(Result<R, E>),
}

impl<R, E> JobCommand<R, E> {
    pub const fn kind(&self) -> JobActionKind {
        match self {
            Self::Start => JobActionKind::Start,
            Self::RequestCancel { .. } => JobActionKind::RequestCancel,
            Self::AcknowledgeCancellation => JobActionKind::AcknowledgeCancellation,
            Self::ForceCancel { .. } => JobActionKind::ForceCancel,
            Self::Complete(_) => JobActionKind::Complete,
        }
    }
}

/// A command carrying the generation it intends to mutate.
#[derive(Debug, Eq, PartialEq)]
pub struct FencedJobCommand<R, E> {
    generation: Generation,
    command: JobCommand<R, E>,
}

impl<R, E> FencedJobCommand<R, E> {
    pub const fn new(generation: Generation, command: JobCommand<R, E>) -> Self {
        Self {
            generation,
            command,
        }
    }

    pub const fn generation(&self) -> Generation {
        self.generation
    }

    pub const fn command(&self) -> &JobCommand<R, E> {
        &self.command
    }

    pub fn into_command(self) -> JobCommand<R, E> {
        self.command
    }
}

/// Event emitted by an accepted job transition.
#[derive(Debug, Eq, PartialEq)]
pub enum JobEvent<R, E> {
    Started,
    CancellationRequested(CancellationReason),
    Succeeded(R),
    Failed(E),
    Cancelled(CancellationReason),
}

impl<R, E> JobEvent<R, E> {
    pub const fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Succeeded(_) | Self::Failed(_) | Self::Cancelled(_)
        )
    }
}

/// Whether a valid command changed job state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransitionDisposition {
    Applied,
    Noop,
}

/// Before/after view plus the optional event emitted by one job reduction.
#[derive(Debug, Eq, PartialEq)]
pub struct JobTransition<R, E> {
    previous: JobPhase,
    current: JobPhase,
    disposition: TransitionDisposition,
    event: Option<JobEvent<R, E>>,
}

impl<R, E> JobTransition<R, E> {
    pub const fn previous(&self) -> JobPhase {
        self.previous
    }

    pub const fn current(&self) -> JobPhase {
        self.current
    }

    pub const fn disposition(&self) -> TransitionDisposition {
        self.disposition
    }

    pub const fn event(&self) -> Option<&JobEvent<R, E>> {
        self.event.as_ref()
    }

    pub fn into_event(self) -> Option<JobEvent<R, E>> {
        self.event
    }
}

/// Why a fenced job command was rejected.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JobCommandError {
    StaleGeneration(GenerationMismatch),
    AlreadyTerminal {
        status: TerminalStatus,
    },
    InvalidTransition {
        phase: JobPhase,
        action: JobActionKind,
    },
    CancellationPending,
}

impl fmt::Display for JobCommandError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::StaleGeneration(mismatch) => mismatch.fmt(formatter),
            Self::AlreadyTerminal { status } => {
                write!(formatter, "job is already terminal: {status:?}")
            }
            Self::InvalidTransition { phase, action } => {
                write!(formatter, "cannot apply {action:?} while job is {phase:?}")
            }
            Self::CancellationPending => {
                formatter.write_str("cancellation is pending worker acknowledgement")
            }
        }
    }
}

/// Why a job could not be restarted.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RestartError {
    Active { phase: JobPhase },
    GenerationExhausted,
}

impl fmt::Display for RestartError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Active { phase } => {
                write!(formatter, "cannot restart an active job in {phase:?}")
            }
            Self::GenerationExhausted => formatter.write_str("job generation number exhausted"),
        }
    }
}

/// Pure state for one job and one generation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct JobRecord {
    id: JobId,
    fence: GenerationFence,
    phase: JobPhase,
    cancellation_reason: Option<CancellationReason>,
    terminal: Option<TerminalStatus>,
}

impl JobRecord {
    pub const fn new(id: JobId, generation: Generation) -> Self {
        Self {
            id,
            fence: GenerationFence::new(generation),
            phase: JobPhase::Queued,
            cancellation_reason: None,
            terminal: None,
        }
    }

    pub const fn initial(id: JobId) -> Self {
        Self::new(id, Generation::INITIAL)
    }

    pub const fn id(self) -> JobId {
        self.id
    }

    pub const fn generation(self) -> Generation {
        self.fence.current()
    }

    pub const fn phase(self) -> JobPhase {
        self.phase
    }

    pub const fn is_terminal(self) -> bool {
        self.phase.is_terminal()
    }

    pub const fn cancellation_reason(self) -> Option<CancellationReason> {
        self.cancellation_reason
    }

    pub const fn terminal_status(self) -> Option<TerminalStatus> {
        self.terminal
    }

    /// Apply one generation-fenced command.
    pub fn apply<R, E>(
        &mut self,
        command: FencedJobCommand<R, E>,
    ) -> Result<JobTransition<R, E>, JobCommandError> {
        let generation = command.generation();
        self.fence
            .check(generation)
            .map_err(JobCommandError::StaleGeneration)?;
        let action = command.command().kind();
        let command = command.into_command();

        if let Some(status) = self.terminal {
            return Err(JobCommandError::AlreadyTerminal { status });
        }

        let previous = self.phase;
        match command {
            JobCommand::Start => {
                if self.phase != JobPhase::Queued {
                    return Err(JobCommandError::InvalidTransition {
                        phase: self.phase,
                        action,
                    });
                }
                self.phase = JobPhase::Running;
                Ok(Self::transition(
                    previous,
                    self.phase,
                    TransitionDisposition::Applied,
                    Some(JobEvent::Started),
                ))
            }
            JobCommand::RequestCancel { reason } => match self.phase {
                JobPhase::Queued => Ok(self.finish_cancel(previous, reason)),
                JobPhase::Running => {
                    self.phase = JobPhase::Cancelling;
                    self.cancellation_reason = Some(reason);
                    Ok(Self::transition(
                        previous,
                        self.phase,
                        TransitionDisposition::Applied,
                        Some(JobEvent::CancellationRequested(reason)),
                    ))
                }
                JobPhase::Cancelling => Ok(Self::transition(
                    previous,
                    self.phase,
                    TransitionDisposition::Noop,
                    None,
                )),
                phase => Err(JobCommandError::InvalidTransition { phase, action }),
            },
            JobCommand::AcknowledgeCancellation => {
                if self.phase != JobPhase::Cancelling {
                    return Err(JobCommandError::InvalidTransition {
                        phase: self.phase,
                        action,
                    });
                }
                let reason = match self.cancellation_reason {
                    Some(reason) => reason,
                    None => CancellationReason::Requested,
                };
                Ok(self.finish_cancel(previous, reason))
            }
            JobCommand::ForceCancel { reason } => match self.phase {
                JobPhase::Queued | JobPhase::Running | JobPhase::Cancelling => {
                    Ok(self.finish_cancel(previous, reason))
                }
                phase => Err(JobCommandError::InvalidTransition { phase, action }),
            },
            JobCommand::Complete(result) => {
                if self.phase == JobPhase::Cancelling {
                    return Err(JobCommandError::CancellationPending);
                }
                if self.phase != JobPhase::Running {
                    return Err(JobCommandError::InvalidTransition {
                        phase: self.phase,
                        action,
                    });
                }
                match result {
                    Ok(value) => Ok(self.finish_success(previous, value)),
                    Err(error) => Ok(self.finish_failure(previous, error)),
                }
            }
        }
    }

    /// Advance a terminal job to a fresh queued generation.
    pub fn restart(&mut self) -> Result<Generation, RestartError> {
        if !self.phase.is_terminal() {
            return Err(RestartError::Active { phase: self.phase });
        }
        let generation = self
            .fence
            .advance()
            .map_err(|_| RestartError::GenerationExhausted)?;
        self.phase = JobPhase::Queued;
        self.cancellation_reason = None;
        self.terminal = None;
        Ok(generation)
    }

    fn finish_success<R, E>(&mut self, previous: JobPhase, value: R) -> JobTransition<R, E> {
        self.phase = JobPhase::Succeeded;
        self.terminal = Some(TerminalStatus::Succeeded);
        self.cancellation_reason = None;
        Self::transition(
            previous,
            self.phase,
            TransitionDisposition::Applied,
            Some(JobEvent::Succeeded(value)),
        )
    }

    fn finish_failure<R, E>(&mut self, previous: JobPhase, error: E) -> JobTransition<R, E> {
        self.phase = JobPhase::Failed;
        self.terminal = Some(TerminalStatus::Failed);
        self.cancellation_reason = None;
        Self::transition(
            previous,
            self.phase,
            TransitionDisposition::Applied,
            Some(JobEvent::Failed(error)),
        )
    }

    fn finish_cancel<R, E>(
        &mut self,
        previous: JobPhase,
        reason: CancellationReason,
    ) -> JobTransition<R, E> {
        self.phase = JobPhase::Cancelled;
        self.terminal = Some(TerminalStatus::Cancelled(reason));
        self.cancellation_reason = Some(reason);
        Self::transition(
            previous,
            self.phase,
            TransitionDisposition::Applied,
            Some(JobEvent::Cancelled(reason)),
        )
    }

    fn transition<R, E>(
        previous: JobPhase,
        current: JobPhase,
        disposition: TransitionDisposition,
        event: Option<JobEvent<R, E>>,
    ) -> JobTransition<R, E> {
        JobTransition {
            previous,
            current,
            disposition,
            event,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CancellationReason, FencedJobCommand, JobCommand, JobCommandError, JobEvent, JobId,
        JobPhase, JobRecord, TerminalStatus, TransitionDisposition,
    };

    #[test]
    fn stale_result_cannot_mutate_a_restarted_generation() {
        let mut record = JobRecord::initial(JobId::new(11));
        let initial = record.generation();
        record
            .apply(FencedJobCommand::new(initial, JobCommand::<u8, u8>::Start))
            .expect("start");
        record
            .apply(FencedJobCommand::new(
                initial,
                JobCommand::Complete::<u8, u8>(Ok(1)),
            ))
            .expect("complete");
        let next = record.restart().expect("restart");
        assert_eq!(record.phase(), JobPhase::Queued);
        assert_eq!(
            record.apply(FencedJobCommand::new(
                initial,
                JobCommand::Complete::<u8, u8>(Ok(2)),
            )),
            Err(JobCommandError::StaleGeneration(
                super::GenerationMismatch {
                    expected: next,
                    received: initial,
                }
            ))
        );
        assert_eq!(record.phase(), JobPhase::Queued);
    }

    #[test]
    fn terminal_event_is_emitted_once() {
        let mut record = JobRecord::initial(JobId::new(3));
        let generation = record.generation();
        record
            .apply(FencedJobCommand::new(
                generation,
                JobCommand::<&str, &str>::Start,
            ))
            .expect("start");
        let transition = record
            .apply(FencedJobCommand::new(
                generation,
                JobCommand::Complete::<&str, &str>(Ok("done")),
            ))
            .expect("first terminal result");
        assert_eq!(transition.disposition(), TransitionDisposition::Applied);
        assert!(matches!(
            transition.event(),
            Some(JobEvent::Succeeded("done"))
        ));
        assert_eq!(record.terminal_status(), Some(TerminalStatus::Succeeded));
        assert_eq!(
            record.apply(FencedJobCommand::new(
                generation,
                JobCommand::Complete::<&str, &str>(Ok("late")),
            )),
            Err(JobCommandError::AlreadyTerminal {
                status: TerminalStatus::Succeeded,
            })
        );
    }

    #[test]
    fn graceful_cancellation_requires_worker_acknowledgement() {
        let mut record = JobRecord::initial(JobId::new(8));
        let generation = record.generation();
        record
            .apply(FencedJobCommand::new(
                generation,
                JobCommand::<u8, u8>::Start,
            ))
            .expect("start");
        let transition = record
            .apply(FencedJobCommand::new(
                generation,
                JobCommand::<u8, u8>::RequestCancel {
                    reason: CancellationReason::Shutdown,
                },
            ))
            .expect("request cancel");
        assert_eq!(transition.current(), JobPhase::Cancelling);
        assert_eq!(
            record.apply(FencedJobCommand::new(
                generation,
                JobCommand::Complete::<u8, u8>(Ok(1)),
            )),
            Err(JobCommandError::CancellationPending)
        );
        record
            .apply(FencedJobCommand::new(
                generation,
                JobCommand::<u8, u8>::AcknowledgeCancellation,
            ))
            .expect("acknowledge");
        assert_eq!(
            record.terminal_status(),
            Some(TerminalStatus::Cancelled(CancellationReason::Shutdown))
        );
    }
}

#[cfg(test)]
mod property_tests {
    use super::{CancellationReason, FencedJobCommand, Generation, JobCommand, JobId, JobRecord};
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn terminal_events_are_at_most_once(commands in prop::collection::vec(any::<u8>(), 0..128)) {
            let mut record = JobRecord::initial(JobId::new(1));
            let generation = Generation::INITIAL;
            let mut terminal_events = 0u8;
            for command in commands {
                let action = match command % 5 {
                    0 => JobCommand::<u8, u8>::Start,
                    1 => JobCommand::<u8, u8>::RequestCancel { reason: CancellationReason::Requested },
                    2 => JobCommand::<u8, u8>::ForceCancel { reason: CancellationReason::Shutdown },
                    3 => JobCommand::<u8, u8>::Complete(Ok(command)),
                    _ => JobCommand::<u8, u8>::AcknowledgeCancellation,
                };
                if let Ok(transition) = record.apply(FencedJobCommand::new(generation, action)) {
                    if let Some(event) = transition.event() {
                        if event.is_terminal() {
                            terminal_events = terminal_events.saturating_add(1);
                        }
                    }
                }
                prop_assert!(terminal_events <= 1);
                prop_assert_eq!(record.is_terminal(), record.terminal_status().is_some());
            }
        }
    }
}

#[cfg(kani)]
mod verification {
    use super::{FencedJobCommand, Generation, JobCommand, JobId, JobPhase, JobRecord};

    #[kani::proof]
    fn stale_command_is_a_state_preserving_rejection() {
        let mut record = JobRecord::new(JobId::new(1), Generation::new(1));
        let before = record.phase();
        let stale = FencedJobCommand::new(Generation::new(0), JobCommand::<u8, u8>::Start);
        assert!(record.apply(stale).is_err());
        assert_eq!(record.phase(), before);
    }

    #[kani::proof]
    fn terminal_transition_cannot_be_repeated() {
        let mut record = JobRecord::initial(JobId::new(1));
        let generation = record.generation();
        record
            .apply(FencedJobCommand::new(
                generation,
                JobCommand::<u8, u8>::Start,
            ))
            .expect("start");
        let first = record.apply(FencedJobCommand::new(
            generation,
            JobCommand::<u8, u8>::Complete(Ok(1)),
        ));
        assert!(first.is_ok());
        let second = record.apply(FencedJobCommand::new(
            generation,
            JobCommand::<u8, u8>::Complete(Ok(2)),
        ));
        assert!(second.is_err());
        assert_eq!(record.phase(), JobPhase::Succeeded);
    }
}
