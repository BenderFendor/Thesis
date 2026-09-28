//! Deterministic accounting for a bounded queue and its worker slots.
//!
//! This module deliberately does not own a channel or a task.  Callers apply
//! the same transition to this ledger when a real channel send, dequeue, or
//! worker completion succeeds.  That keeps capacity accounting testable and
//! independent of Tokio or a database transaction.

use core::fmt;

/// Limits for queued items and concurrently running items.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct QueueLimits {
    max_queued: u32,
    max_in_flight: u32,
}

impl QueueLimits {
    /// Construct non-zero queue and worker limits.
    pub const fn new(max_queued: u32, max_in_flight: u32) -> Result<Self, QueueLimitError> {
        if max_queued == 0 {
            return Err(QueueLimitError::ZeroQueuedCapacity);
        }
        if max_in_flight == 0 {
            return Err(QueueLimitError::ZeroInFlightCapacity);
        }
        Ok(Self {
            max_queued,
            max_in_flight,
        })
    }

    /// Maximum number of admitted but not yet started items.
    pub const fn max_queued(self) -> u32 {
        self.max_queued
    }

    /// Maximum number of items concurrently owned by workers.
    pub const fn max_in_flight(self) -> u32 {
        self.max_in_flight
    }
}

/// Invalid queue limit configuration.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum QueueLimitError {
    /// A queue with no admission capacity cannot accept work.
    ZeroQueuedCapacity,
    /// A worker pool with no slots cannot make progress.
    ZeroInFlightCapacity,
}

impl fmt::Display for QueueLimitError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ZeroQueuedCapacity => formatter.write_str("queued capacity must be non-zero"),
            Self::ZeroInFlightCapacity => {
                formatter.write_str("in-flight capacity must be non-zero")
            }
        }
    }
}

/// A reason an operation must apply backpressure instead of accepting work.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Backpressure {
    /// The queue has been closed and cannot admit new work.
    Closed,
    /// The queue has reached its queued-item limit.
    QueueFull { limit: u32, current: u32 },
    /// All worker slots are occupied; queued work remains buffered.
    InFlightFull { limit: u32, current: u32 },
}

impl Backpressure {
    /// Whether retrying after progress by another actor may succeed.
    pub const fn is_retryable(self) -> bool {
        !matches!(self, Self::Closed)
    }
}

impl fmt::Display for Backpressure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Closed => formatter.write_str("queue is closed"),
            Self::QueueFull { limit, current } => {
                write!(formatter, "queue is full ({current}/{limit})")
            }
            Self::InFlightFull { limit, current } => {
                write!(formatter, "worker slots are full ({current}/{limit})")
            }
        }
    }
}

/// A pure command for the queue accounting reducer.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum QueueCommand {
    /// Admit one item into the bounded queue.
    Enqueue,
    /// Move one queued item into a worker slot.
    Start,
    /// Mark one worker-owned item as successfully completed.
    Complete,
    /// Cancel one queued item.
    CancelQueued,
    /// Cancel one worker-owned item.
    CancelInFlight,
    /// Cancel every currently queued item.
    DrainQueued,
    /// Reject future admissions while allowing existing items to finish.
    Close,
}

/// The observable result of an accepted queue command.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum QueueEffect {
    Enqueued { queued: u32, available: u32 },
    Started { queued: u32, in_flight: u32 },
    Completed { in_flight: u32, completed: u64 },
    CancelledQueued { queued: u32, cancelled: u64 },
    CancelledInFlight { in_flight: u32, cancelled: u64 },
    Drained { count: u32, cancelled: u64 },
    Closed,
    AlreadyClosed,
}

/// Errors returned when a queue command cannot be applied.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum QueueError {
    /// Admission or worker-slot capacity requires backpressure.
    Backpressure(Backpressure),
    /// A command required a queued item, but none exists.
    NoQueuedItems,
    /// A command required an in-flight item, but none exists.
    NoInFlightItems,
    /// A monotonic accounting counter cannot advance without wrapping.
    CounterOverflow,
}

impl fmt::Display for QueueError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Backpressure(reason) => reason.fmt(formatter),
            Self::NoQueuedItems => formatter.write_str("queue has no queued items"),
            Self::NoInFlightItems => formatter.write_str("queue has no in-flight items"),
            Self::CounterOverflow => formatter.write_str("queue accounting counter overflow"),
        }
    }
}

/// An immutable accounting snapshot suitable for metrics or a protocol frame.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct QueueSnapshot {
    limits: QueueLimits,
    queued: u32,
    in_flight: u32,
    accepted: u64,
    completed: u64,
    cancelled: u64,
    closed: bool,
}

impl QueueSnapshot {
    pub const fn limits(self) -> QueueLimits {
        self.limits
    }

    pub const fn queued(self) -> u32 {
        self.queued
    }

    pub const fn in_flight(self) -> u32 {
        self.in_flight
    }

    pub const fn accepted(self) -> u64 {
        self.accepted
    }

    pub const fn completed(self) -> u64 {
        self.completed
    }

    pub const fn cancelled(self) -> u64 {
        self.cancelled
    }

    pub const fn is_closed(self) -> bool {
        self.closed
    }

    /// Number of admitted items that remain queued or worker-owned.
    pub const fn pending(self) -> u64 {
        self.queued as u64 + self.in_flight as u64
    }

    /// Remaining queue slots before the next enqueue is backpressured.
    pub const fn queued_capacity_remaining(self) -> u32 {
        self.limits.max_queued - self.queued
    }

    /// Whether no admitted item remains pending.
    pub const fn is_idle(self) -> bool {
        self.queued == 0 && self.in_flight == 0
    }
}

/// The before/after view returned by every successful reducer step.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct QueueTransition {
    before: QueueSnapshot,
    after: QueueSnapshot,
    effect: QueueEffect,
}

impl QueueTransition {
    pub const fn before(self) -> QueueSnapshot {
        self.before
    }

    pub const fn after(self) -> QueueSnapshot {
        self.after
    }

    pub const fn effect(self) -> QueueEffect {
        self.effect
    }
}

/// Bounded queue state with checked, monotonic accounting.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct QueueAccounting {
    limits: QueueLimits,
    queued: u32,
    in_flight: u32,
    accepted: u64,
    completed: u64,
    cancelled: u64,
    closed: bool,
}

impl QueueAccounting {
    /// Start an open, empty queue.
    pub const fn new(limits: QueueLimits) -> Self {
        Self {
            limits,
            queued: 0,
            in_flight: 0,
            accepted: 0,
            completed: 0,
            cancelled: 0,
            closed: false,
        }
    }

    /// Return a copy suitable for a response or metrics event.
    pub const fn snapshot(self) -> QueueSnapshot {
        QueueSnapshot {
            limits: self.limits,
            queued: self.queued,
            in_flight: self.in_flight,
            accepted: self.accepted,
            completed: self.completed,
            cancelled: self.cancelled,
            closed: self.closed,
        }
    }

    /// Apply one deterministic queue transition.
    pub fn apply(&mut self, command: QueueCommand) -> Result<QueueTransition, QueueError> {
        let before = self.snapshot();
        let effect = match command {
            QueueCommand::Enqueue => self.enqueue_one()?,
            QueueCommand::Start => self.start_one()?,
            QueueCommand::Complete => self.complete_one()?,
            QueueCommand::CancelQueued => self.cancel_queued_one()?,
            QueueCommand::CancelInFlight => self.cancel_in_flight_one()?,
            QueueCommand::DrainQueued => self.drain_queued_all()?,
            QueueCommand::Close => {
                if self.closed {
                    QueueEffect::AlreadyClosed
                } else {
                    self.closed = true;
                    QueueEffect::Closed
                }
            }
        };
        let after = self.snapshot();
        Ok(QueueTransition {
            before,
            after,
            effect,
        })
    }

    pub fn enqueue(&mut self) -> Result<QueueTransition, QueueError> {
        self.apply(QueueCommand::Enqueue)
    }

    pub fn start(&mut self) -> Result<QueueTransition, QueueError> {
        self.apply(QueueCommand::Start)
    }

    pub fn complete(&mut self) -> Result<QueueTransition, QueueError> {
        self.apply(QueueCommand::Complete)
    }

    pub fn cancel_queued(&mut self) -> Result<QueueTransition, QueueError> {
        self.apply(QueueCommand::CancelQueued)
    }

    pub fn cancel_in_flight(&mut self) -> Result<QueueTransition, QueueError> {
        self.apply(QueueCommand::CancelInFlight)
    }

    pub fn drain_queued(&mut self) -> Result<QueueTransition, QueueError> {
        self.apply(QueueCommand::DrainQueued)
    }

    pub fn close(&mut self) -> Result<QueueTransition, QueueError> {
        self.apply(QueueCommand::Close)
    }

    fn enqueue_one(&mut self) -> Result<QueueEffect, QueueError> {
        if self.closed {
            return Err(QueueError::Backpressure(Backpressure::Closed));
        }
        if self.queued == self.limits.max_queued {
            return Err(QueueError::Backpressure(Backpressure::QueueFull {
                limit: self.limits.max_queued,
                current: self.queued,
            }));
        }
        self.accepted = self
            .accepted
            .checked_add(1)
            .ok_or(QueueError::CounterOverflow)?;
        self.queued += 1;
        Ok(QueueEffect::Enqueued {
            queued: self.queued,
            available: self.limits.max_queued - self.queued,
        })
    }

    fn start_one(&mut self) -> Result<QueueEffect, QueueError> {
        if self.queued == 0 {
            return Err(QueueError::NoQueuedItems);
        }
        if self.in_flight == self.limits.max_in_flight {
            return Err(QueueError::Backpressure(Backpressure::InFlightFull {
                limit: self.limits.max_in_flight,
                current: self.in_flight,
            }));
        }
        self.queued -= 1;
        self.in_flight += 1;
        Ok(QueueEffect::Started {
            queued: self.queued,
            in_flight: self.in_flight,
        })
    }

    fn complete_one(&mut self) -> Result<QueueEffect, QueueError> {
        if self.in_flight == 0 {
            return Err(QueueError::NoInFlightItems);
        }
        self.completed = self
            .completed
            .checked_add(1)
            .ok_or(QueueError::CounterOverflow)?;
        self.in_flight -= 1;
        Ok(QueueEffect::Completed {
            in_flight: self.in_flight,
            completed: self.completed,
        })
    }

    fn cancel_queued_one(&mut self) -> Result<QueueEffect, QueueError> {
        if self.queued == 0 {
            return Err(QueueError::NoQueuedItems);
        }
        self.cancelled = self
            .cancelled
            .checked_add(1)
            .ok_or(QueueError::CounterOverflow)?;
        self.queued -= 1;
        Ok(QueueEffect::CancelledQueued {
            queued: self.queued,
            cancelled: self.cancelled,
        })
    }

    fn cancel_in_flight_one(&mut self) -> Result<QueueEffect, QueueError> {
        if self.in_flight == 0 {
            return Err(QueueError::NoInFlightItems);
        }
        self.cancelled = self
            .cancelled
            .checked_add(1)
            .ok_or(QueueError::CounterOverflow)?;
        self.in_flight -= 1;
        Ok(QueueEffect::CancelledInFlight {
            in_flight: self.in_flight,
            cancelled: self.cancelled,
        })
    }

    fn drain_queued_all(&mut self) -> Result<QueueEffect, QueueError> {
        let count = self.queued;
        self.cancelled = self
            .cancelled
            .checked_add(u64::from(count))
            .ok_or(QueueError::CounterOverflow)?;
        self.queued = 0;
        Ok(QueueEffect::Drained {
            count,
            cancelled: self.cancelled,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{Backpressure, QueueAccounting, QueueCommand, QueueError, QueueLimits};

    #[test]
    fn queue_rejects_admission_after_close() {
        let limits = QueueLimits::new(2, 1).expect("positive limits");
        let mut queue = QueueAccounting::new(limits);
        assert!(queue.close().is_ok());
        assert_eq!(
            queue.enqueue(),
            Err(QueueError::Backpressure(Backpressure::Closed))
        );
    }

    #[test]
    fn queue_keeps_queued_and_in_flight_bounds_separate() {
        let limits = QueueLimits::new(2, 1).expect("positive limits");
        let mut queue = QueueAccounting::new(limits);
        queue.enqueue().expect("first enqueue");
        queue.enqueue().expect("second enqueue");
        queue.start().expect("first worker slot");
        assert_eq!(
            queue.apply(QueueCommand::Start),
            Err(QueueError::Backpressure(Backpressure::InFlightFull {
                limit: 1,
                current: 1,
            }))
        );
        let snapshot = queue.snapshot();
        assert_eq!(snapshot.queued(), 1);
        assert_eq!(snapshot.in_flight(), 1);
        assert_eq!(snapshot.accepted(), 2);
    }
}

#[cfg(test)]
mod property_tests {
    use super::{QueueAccounting, QueueCommand, QueueLimits};
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn arbitrary_command_sequences_preserve_accounting_bounds(
            max_queued in 1u32..=8,
            max_in_flight in 1u32..=8,
            commands in prop::collection::vec(any::<u8>(), 0..256),
        ) {
            let limits = QueueLimits::new(max_queued, max_in_flight).expect("positive limits");
            let mut queue = QueueAccounting::new(limits);
            for command in commands {
                let _ = match command % 7 {
                    0 => queue.apply(QueueCommand::Enqueue),
                    1 => queue.apply(QueueCommand::Start),
                    2 => queue.apply(QueueCommand::Complete),
                    3 => queue.apply(QueueCommand::CancelQueued),
                    4 => queue.apply(QueueCommand::CancelInFlight),
                    5 => queue.apply(QueueCommand::DrainQueued),
                    _ => queue.apply(QueueCommand::Close),
                };
                let snapshot = queue.snapshot();
                prop_assert!(snapshot.queued() <= max_queued);
                prop_assert!(snapshot.in_flight() <= max_in_flight);
                prop_assert_eq!(
                    snapshot.accepted(),
                    snapshot.pending() + snapshot.completed() + snapshot.cancelled(),
                );
            }
        }
    }
}

#[cfg(kani)]
mod verification {
    use super::{QueueAccounting, QueueCommand, QueueLimits};

    #[kani::proof]
    fn one_bounded_step_preserves_queue_invariants() {
        let max_queued: u32 = kani::any();
        let max_in_flight: u32 = kani::any();
        kani::assume(max_queued > 0 && max_queued <= 3);
        kani::assume(max_in_flight > 0 && max_in_flight <= 3);
        let limits = QueueLimits::new(max_queued, max_in_flight).expect("bounded limits");
        let mut queue = QueueAccounting::new(limits);
        let command: u8 = kani::any();
        let _ = match command % 7 {
            0 => queue.apply(QueueCommand::Enqueue),
            1 => queue.apply(QueueCommand::Start),
            2 => queue.apply(QueueCommand::Complete),
            3 => queue.apply(QueueCommand::CancelQueued),
            4 => queue.apply(QueueCommand::CancelInFlight),
            5 => queue.apply(QueueCommand::DrainQueued),
            _ => queue.apply(QueueCommand::Close),
        };
        let snapshot = queue.snapshot();
        assert!(snapshot.queued() <= max_queued);
        assert!(snapshot.in_flight() <= max_in_flight);
        assert_eq!(
            snapshot.accepted(),
            snapshot.pending() + snapshot.completed() + snapshot.cancelled(),
        );
    }
}
