//! Strictly ordered, allocation-free event sequencing.
//!
//! A producer and a consumer each own an [`EventCursor`].  The producer uses
//! [`EventCursor::issue`] and the consumer uses [`EventCursor::accept`].  A
//! consumer therefore rejects both duplicates and gaps before handing a
//! payload to an application-level stream.

use core::cmp::Ordering;
use core::fmt;

/// A monotonically increasing event sequence number.
#[derive(Clone, Copy, Debug, Default, Eq, Ord, PartialEq, PartialOrd)]
pub struct EventSequence(u64);

impl EventSequence {
    /// The first sequence number in a stream.
    pub const FIRST: Self = Self(0);

    /// Construct a sequence number from its wire representation.
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    /// Return the wire representation.
    pub const fn value(self) -> u64 {
        self.0
    }

    /// Return the next sequence, or `None` when the number space is exhausted.
    pub const fn next(self) -> Option<Self> {
        match self.0.checked_add(1) {
            Some(value) => Some(Self(value)),
            None => None,
        }
    }
}

impl fmt::Display for EventSequence {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// An event carrying the sequence assigned by a producer.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SequencedEvent<T> {
    sequence: EventSequence,
    payload: T,
}

impl<T> SequencedEvent<T> {
    /// Construct an event when restoring a persisted or transported record.
    pub const fn new(sequence: EventSequence, payload: T) -> Self {
        Self { sequence, payload }
    }

    /// Return this event's sequence number.
    pub const fn sequence(&self) -> EventSequence {
        self.sequence
    }

    /// Borrow the payload without consuming the event.
    pub const fn payload(&self) -> &T {
        &self.payload
    }

    /// Consume the event and return its payload.
    pub fn into_payload(self) -> T {
        self.payload
    }
}

/// A strict producer or consumer cursor.
///
/// The cursor starts at [`EventSequence::FIRST`].  Once the sequence number
/// space is exhausted, no additional event can be issued or accepted.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EventCursor {
    next: Option<EventSequence>,
}

impl Default for EventCursor {
    fn default() -> Self {
        Self::new()
    }
}

impl EventCursor {
    /// Create a cursor at the first sequence number.
    pub const fn new() -> Self {
        Self {
            next: Some(EventSequence::FIRST),
        }
    }

    /// Return the next sequence expected or issued by this cursor.
    pub const fn next(&self) -> Option<EventSequence> {
        self.next
    }

    /// Whether the sequence number space is exhausted.
    pub const fn is_exhausted(&self) -> bool {
        self.next.is_none()
    }

    /// Assign the next contiguous sequence to a payload.
    pub fn issue<T>(&mut self, payload: T) -> Result<SequencedEvent<T>, EventOrderError> {
        let sequence = self.next.ok_or(EventOrderError::Exhausted)?;
        self.next = sequence.next();
        Ok(SequencedEvent { sequence, payload })
    }

    /// Accept exactly the next contiguous event and return its payload.
    pub fn accept<T>(&mut self, event: SequencedEvent<T>) -> Result<T, EventOrderError> {
        let expected = self.next.ok_or(EventOrderError::Exhausted)?;
        match event.sequence.cmp(&expected) {
            Ordering::Equal => {
                self.next = expected.next();
                Ok(event.payload)
            }
            Ordering::Less => Err(EventOrderError::Duplicate {
                expected,
                received: event.sequence,
            }),
            Ordering::Greater => Err(EventOrderError::Gap {
                expected,
                received: event.sequence,
            }),
        }
    }
}

/// Why a sequenced event could not be accepted or issued.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EventOrderError {
    /// No sequence number remains in the finite `u64` sequence space.
    Exhausted,
    /// The received event was already observed by this cursor.
    Duplicate {
        expected: EventSequence,
        received: EventSequence,
    },
    /// The received event skipped one or more sequence numbers.
    Gap {
        expected: EventSequence,
        received: EventSequence,
    },
}

impl fmt::Display for EventOrderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Exhausted => formatter.write_str("event sequence exhausted"),
            Self::Duplicate { expected, received } => write!(
                formatter,
                "duplicate event sequence {received}; expected {expected}"
            ),
            Self::Gap { expected, received } => write!(
                formatter,
                "event sequence gap: expected {expected}, received {received}"
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{EventCursor, EventOrderError, EventSequence, SequencedEvent};

    #[test]
    fn producer_and_consumer_accept_contiguous_events() {
        let mut producer = EventCursor::new();
        let mut consumer = EventCursor::new();
        let first = producer.issue("first").expect("first sequence");
        let second = producer.issue("second").expect("second sequence");

        assert_eq!(consumer.accept(first), Ok("first"));
        assert_eq!(consumer.accept(second), Ok("second"));
        assert_eq!(consumer.next(), Some(EventSequence::new(2)));
    }

    #[test]
    fn consumer_rejects_gaps_and_duplicates_without_advancing() {
        let mut consumer = EventCursor::new();
        let gap = SequencedEvent::new(EventSequence::new(2), "gap");
        assert_eq!(
            consumer.accept(gap),
            Err(EventOrderError::Gap {
                expected: EventSequence::FIRST,
                received: EventSequence::new(2),
            })
        );
        assert_eq!(consumer.next(), Some(EventSequence::FIRST));

        let first = SequencedEvent::new(EventSequence::FIRST, "first");
        assert_eq!(consumer.accept(first), Ok("first"));
        let duplicate = SequencedEvent::new(EventSequence::FIRST, "duplicate");
        assert_eq!(
            consumer.accept(duplicate),
            Err(EventOrderError::Duplicate {
                expected: EventSequence::new(1),
                received: EventSequence::FIRST,
            })
        );
    }

    #[test]
    fn max_sequence_is_accepted_once() {
        let max = EventSequence::new(u64::MAX);
        let mut consumer = EventCursor { next: Some(max) };
        assert_eq!(consumer.accept(SequencedEvent::new(max, 7)), Ok(7));
        assert!(consumer.is_exhausted());
        assert_eq!(
            consumer.accept(SequencedEvent::new(max, 8)),
            Err(EventOrderError::Exhausted)
        );
    }
}

#[cfg(test)]
mod property_tests {
    use super::{EventCursor, EventSequence};
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn issuing_n_events_advances_exactly_n(
            count in 0usize..128,
        ) {
            let mut cursor = EventCursor::new();
            for index in 0..count {
                let event = cursor.issue(index).expect("bounded sequence");
                prop_assert_eq!(event.sequence().value(), index as u64);
            }
            prop_assert_eq!(cursor.next(), Some(EventSequence::new(count as u64)));
        }
    }
}

#[cfg(kani)]
mod verification {
    use super::{EventCursor, SequencedEvent};

    #[kani::proof]
    fn accepting_the_expected_sequence_advances_once() {
        let value: u8 = kani::any();
        let mut cursor = EventCursor::new();
        let event = SequencedEvent::new(cursor.next().expect("initial sequence"), value);
        assert_eq!(cursor.accept(event), Ok(value));
        assert_eq!(cursor.next().expect("next sequence").value(), 1);
    }
}
