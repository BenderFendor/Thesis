use vstd::prelude::*;

verus! {

pub open spec fn is_ascii_digit(byte: u8) -> bool {
    b'0' <= byte && byte <= b'9'
}

pub open spec fn no_ascii_digit(bytes: Seq<u8>, start: int, end: int) -> bool {
    forall |index: int|
        start <= index && index < end && 0 <= index && index < bytes.len()
            ==> !is_ascii_digit(bytes[index])
}

/// `digits` contains the first zero, one, or two ASCII digits in `bytes[start..]`.
pub open spec fn scan_contract(bytes: Seq<u8>, start: int, digits: Seq<u8>) -> bool {
    if digits.len() == 0 {
        0 <= start && start <= bytes.len()
            && no_ascii_digit(bytes, start, bytes.len() as int)
    } else if digits.len() == 1 {
        0 <= start && start <= bytes.len()
            && exists |first: int|
                start <= first && first < bytes.len() && is_ascii_digit(bytes[first])
                    && digits[0] == bytes[first]
                    && no_ascii_digit(bytes, start, first)
                    && no_ascii_digit(bytes, first + 1, bytes.len() as int)
    } else if digits.len() == 2 {
        0 <= start && start <= bytes.len()
            && exists |first: int, second: int|
                start <= first && first < second && second < bytes.len()
                    && is_ascii_digit(bytes[first]) && is_ascii_digit(bytes[second])
                    && digits[0] == bytes[first] && digits[1] == bytes[second]
                    && no_ascii_digit(bytes, start, first)
                    && no_ascii_digit(bytes, first + 1, second)
    } else {
        false
    }
}

/// Scan forward and retain at most the first two ASCII digit bytes.
pub open spec fn scan_two_ascii_digits(bytes: Seq<u8>, start: int) -> Seq<u8>
    decreases bytes.len() - start,
{
    if start < 0 || start >= bytes.len() {
        Seq::empty()
    } else {
        let tail = scan_two_ascii_digits(bytes, start + 1);
        if is_ascii_digit(bytes[start]) {
            if tail.len() == 0 {
                Seq::empty().push(bytes[start])
            } else {
                Seq::empty().push(bytes[start]).push(tail[0])
            }
        } else {
            tail
        }
    }
}

/// Model of `normalize_cameo_root_code` over arbitrary bytes.
/// This abstract specification does not prove refinement to the Rust function.
pub open spec fn normalize_cameo_root_code(bytes: Seq<u8>) -> Option<Seq<u8>> {
    let digits = scan_two_ascii_digits(bytes, 0);
    if digits.len() == 0 {
        None
    } else if digits.len() == 1 {
        Some(Seq::empty().push(b'0').push(digits[0]))
    } else {
        Some(Seq::empty().push(digits[0]).push(digits[1]))
    }
}

proof fn scan_retains_first_two_ascii_digits(bytes: Seq<u8>, start: int)
    requires
        0 <= start && start <= bytes.len(),
    ensures
        scan_contract(bytes, start, scan_two_ascii_digits(bytes, start)),
    decreases bytes.len() - start,
{
    if start < bytes.len() {
        scan_retains_first_two_ascii_digits(bytes, start + 1);
        let tail = scan_two_ascii_digits(bytes, start + 1);
        if is_ascii_digit(bytes[start]) {
            if tail.len() == 0 {
                assert(scan_contract(bytes, start + 1, tail));
                assert(no_ascii_digit(bytes, start + 1, bytes.len() as int));
            } else {
                assert(scan_contract(bytes, start + 1, tail));
                assert(tail.len() == 1 || tail.len() == 2);
            }
        } else {
            assert(scan_contract(bytes, start + 1, tail));
            assert(no_ascii_digit(bytes, start, start + 1));
        }
    }
}

/// Normalization returns no value exactly when no ASCII digit occurs; otherwise
/// it returns two ASCII digits in the order selected by the scanner.
pub proof fn normalization_has_contract(bytes: Seq<u8>)
    ensures
        match normalize_cameo_root_code(bytes) {
            None => no_ascii_digit(bytes, 0, bytes.len() as int),
            Some(output) => !no_ascii_digit(bytes, 0, bytes.len() as int)
                && output.len() == 2
                && is_ascii_digit(output[0])
                && is_ascii_digit(output[1])
                && if scan_two_ascii_digits(bytes, 0).len() == 1 {
                    output[0] == b'0'
                        && output[1] == scan_two_ascii_digits(bytes, 0)[0]
                } else {
                    output == Seq::empty()
                        .push(scan_two_ascii_digits(bytes, 0)[0])
                        .push(scan_two_ascii_digits(bytes, 0)[1])
                },
        },
{
    scan_retains_first_two_ascii_digits(bytes, 0);
    let digits = scan_two_ascii_digits(bytes, 0);
    if digits.len() == 0 {
        assert(no_ascii_digit(bytes, 0, bytes.len() as int));
    } else {
        assert(digits.len() == 1 || digits.len() == 2);
        assert(scan_contract(bytes, 0, digits));
        if digits.len() == 1 {
            assert(is_ascii_digit(digits[0]));
            let first = choose |first: int|
                0 <= first && first < bytes.len()
                    && is_ascii_digit(bytes[first])
                    && digits[0] == bytes[first];
            assert(0 <= first && first < bytes.len());
            assert(is_ascii_digit(bytes[first]));
            assert(!no_ascii_digit(bytes, 0, bytes.len() as int));
        } else {
            assert(is_ascii_digit(digits[0]));
            assert(is_ascii_digit(digits[1]));
            let first = choose |first: int|
                0 <= first && first < bytes.len()
                    && is_ascii_digit(bytes[first])
                    && digits[0] == bytes[first];
            assert(0 <= first && first < bytes.len());
            assert(is_ascii_digit(bytes[first]));
            assert(!no_ascii_digit(bytes, 0, bytes.len() as int));
        }
    }
}

/// A one-digit input is reachable and is normalized by left-padding with zero.
pub proof fn one_digit_input_is_reachable()
    ensures
        normalize_cameo_root_code(Seq::empty().push(b'7'))
            == Some(Seq::empty().push(b'0').push(b'7')),
{
    scan_retains_first_two_ascii_digits(Seq::empty().push(b'7'), 0);
    assert(scan_two_ascii_digits(Seq::empty().push(b'7'), 0).len() == 1);
}

fn main() { }

}
