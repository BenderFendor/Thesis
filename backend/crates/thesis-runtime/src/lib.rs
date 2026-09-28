//! Pure runtime protocol reducers for bounded jobs, queues, and event streams.
//!
//! The crate intentionally owns no Tokio channel, network client, provider, or
//! database handle.  Integrators apply a successful external operation to the
//! corresponding reducer, then use the returned transition as the protocol
//! record to publish or persist.
//!
//! Informal TLA+ correspondence for later refinement:
//! - `QueueAccounting` maps to `queued`, `in_flight`, `accepted`,
//!   `completed`, and `cancelled`; its accounting equation is the queue
//!   invariant.
//! - `JobRecord` maps to `phase`, `generation`, and `terminal`; `apply` is the
//!   `Next` relation and stale commands are state-preserving rejected steps.
//! - `EventCursor.next` is the stream cursor; `accept` permits only the
//!   contiguous next sequence, so duplicate and gap deliveries are rejected.
//! - `ShutdownController.phase` gates admission and turns cancellation into an
//!   explicit protocol transition rather than an implicit task side effect.

#![no_std]
#![forbid(unsafe_code)]

pub mod event;
pub mod job;
pub mod queue;
pub mod shutdown;

pub use event::{EventCursor, EventOrderError, EventSequence, SequencedEvent};
pub use job::{
    CancellationReason, FencedJobCommand, Generation, GenerationError, GenerationFence,
    GenerationMismatch, JobActionKind, JobCommand, JobCommandError, JobEvent, JobId, JobPhase,
    JobRecord, JobTransition, RestartError, TerminalStatus, TransitionDisposition,
};
pub use queue::{
    Backpressure, QueueAccounting, QueueCommand, QueueEffect, QueueError, QueueLimitError,
    QueueLimits, QueueSnapshot, QueueTransition,
};
pub use shutdown::{
    ShutdownCommand, ShutdownController, ShutdownDisposition, ShutdownError, ShutdownPhase,
    ShutdownTransition,
};
