use std::sync::LazyLock;

use regex::Regex;

use super::super::AtlasConfidenceTier;

static LABEL_SEPARATORS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\W_]+").expect("Atlas label regex is valid"));

// Python Unicode 16 casefold exceptions relative to Rust lowercase, sorted for binary search.
const CASEFOLD_EXCEPTIONS: &[(char, &str)] = &[
    ('\u{00b5}', "\u{03bc}"),
    ('\u{00df}', "\u{0073}\u{0073}"),
    ('\u{0149}', "\u{02bc}\u{006e}"),
    ('\u{017f}', "\u{0073}"),
    ('\u{01f0}', "\u{006a}\u{030c}"),
    ('\u{0345}', "\u{03b9}"),
    ('\u{0390}', "\u{03b9}\u{0308}\u{0301}"),
    ('\u{03b0}', "\u{03c5}\u{0308}\u{0301}"),
    ('\u{03c2}', "\u{03c3}"),
    ('\u{03d0}', "\u{03b2}"),
    ('\u{03d1}', "\u{03b8}"),
    ('\u{03d5}', "\u{03c6}"),
    ('\u{03d6}', "\u{03c0}"),
    ('\u{03f0}', "\u{03ba}"),
    ('\u{03f1}', "\u{03c1}"),
    ('\u{03f5}', "\u{03b5}"),
    ('\u{0587}', "\u{0565}\u{0582}"),
    ('\u{13a0}', "\u{13a0}"),
    ('\u{13a1}', "\u{13a1}"),
    ('\u{13a2}', "\u{13a2}"),
    ('\u{13a3}', "\u{13a3}"),
    ('\u{13a4}', "\u{13a4}"),
    ('\u{13a5}', "\u{13a5}"),
    ('\u{13a6}', "\u{13a6}"),
    ('\u{13a7}', "\u{13a7}"),
    ('\u{13a8}', "\u{13a8}"),
    ('\u{13a9}', "\u{13a9}"),
    ('\u{13aa}', "\u{13aa}"),
    ('\u{13ab}', "\u{13ab}"),
    ('\u{13ac}', "\u{13ac}"),
    ('\u{13ad}', "\u{13ad}"),
    ('\u{13ae}', "\u{13ae}"),
    ('\u{13af}', "\u{13af}"),
    ('\u{13b0}', "\u{13b0}"),
    ('\u{13b1}', "\u{13b1}"),
    ('\u{13b2}', "\u{13b2}"),
    ('\u{13b3}', "\u{13b3}"),
    ('\u{13b4}', "\u{13b4}"),
    ('\u{13b5}', "\u{13b5}"),
    ('\u{13b6}', "\u{13b6}"),
    ('\u{13b7}', "\u{13b7}"),
    ('\u{13b8}', "\u{13b8}"),
    ('\u{13b9}', "\u{13b9}"),
    ('\u{13ba}', "\u{13ba}"),
    ('\u{13bb}', "\u{13bb}"),
    ('\u{13bc}', "\u{13bc}"),
    ('\u{13bd}', "\u{13bd}"),
    ('\u{13be}', "\u{13be}"),
    ('\u{13bf}', "\u{13bf}"),
    ('\u{13c0}', "\u{13c0}"),
    ('\u{13c1}', "\u{13c1}"),
    ('\u{13c2}', "\u{13c2}"),
    ('\u{13c3}', "\u{13c3}"),
    ('\u{13c4}', "\u{13c4}"),
    ('\u{13c5}', "\u{13c5}"),
    ('\u{13c6}', "\u{13c6}"),
    ('\u{13c7}', "\u{13c7}"),
    ('\u{13c8}', "\u{13c8}"),
    ('\u{13c9}', "\u{13c9}"),
    ('\u{13ca}', "\u{13ca}"),
    ('\u{13cb}', "\u{13cb}"),
    ('\u{13cc}', "\u{13cc}"),
    ('\u{13cd}', "\u{13cd}"),
    ('\u{13ce}', "\u{13ce}"),
    ('\u{13cf}', "\u{13cf}"),
    ('\u{13d0}', "\u{13d0}"),
    ('\u{13d1}', "\u{13d1}"),
    ('\u{13d2}', "\u{13d2}"),
    ('\u{13d3}', "\u{13d3}"),
    ('\u{13d4}', "\u{13d4}"),
    ('\u{13d5}', "\u{13d5}"),
    ('\u{13d6}', "\u{13d6}"),
    ('\u{13d7}', "\u{13d7}"),
    ('\u{13d8}', "\u{13d8}"),
    ('\u{13d9}', "\u{13d9}"),
    ('\u{13da}', "\u{13da}"),
    ('\u{13db}', "\u{13db}"),
    ('\u{13dc}', "\u{13dc}"),
    ('\u{13dd}', "\u{13dd}"),
    ('\u{13de}', "\u{13de}"),
    ('\u{13df}', "\u{13df}"),
    ('\u{13e0}', "\u{13e0}"),
    ('\u{13e1}', "\u{13e1}"),
    ('\u{13e2}', "\u{13e2}"),
    ('\u{13e3}', "\u{13e3}"),
    ('\u{13e4}', "\u{13e4}"),
    ('\u{13e5}', "\u{13e5}"),
    ('\u{13e6}', "\u{13e6}"),
    ('\u{13e7}', "\u{13e7}"),
    ('\u{13e8}', "\u{13e8}"),
    ('\u{13e9}', "\u{13e9}"),
    ('\u{13ea}', "\u{13ea}"),
    ('\u{13eb}', "\u{13eb}"),
    ('\u{13ec}', "\u{13ec}"),
    ('\u{13ed}', "\u{13ed}"),
    ('\u{13ee}', "\u{13ee}"),
    ('\u{13ef}', "\u{13ef}"),
    ('\u{13f0}', "\u{13f0}"),
    ('\u{13f1}', "\u{13f1}"),
    ('\u{13f2}', "\u{13f2}"),
    ('\u{13f3}', "\u{13f3}"),
    ('\u{13f4}', "\u{13f4}"),
    ('\u{13f5}', "\u{13f5}"),
    ('\u{13f8}', "\u{13f0}"),
    ('\u{13f9}', "\u{13f1}"),
    ('\u{13fa}', "\u{13f2}"),
    ('\u{13fb}', "\u{13f3}"),
    ('\u{13fc}', "\u{13f4}"),
    ('\u{13fd}', "\u{13f5}"),
    ('\u{1c80}', "\u{0432}"),
    ('\u{1c81}', "\u{0434}"),
    ('\u{1c82}', "\u{043e}"),
    ('\u{1c83}', "\u{0441}"),
    ('\u{1c84}', "\u{0442}"),
    ('\u{1c85}', "\u{0442}"),
    ('\u{1c86}', "\u{044a}"),
    ('\u{1c87}', "\u{0463}"),
    ('\u{1c88}', "\u{a64b}"),
    ('\u{1e96}', "\u{0068}\u{0331}"),
    ('\u{1e97}', "\u{0074}\u{0308}"),
    ('\u{1e98}', "\u{0077}\u{030a}"),
    ('\u{1e99}', "\u{0079}\u{030a}"),
    ('\u{1e9a}', "\u{0061}\u{02be}"),
    ('\u{1e9b}', "\u{1e61}"),
    ('\u{1e9e}', "\u{0073}\u{0073}"),
    ('\u{1f50}', "\u{03c5}\u{0313}"),
    ('\u{1f52}', "\u{03c5}\u{0313}\u{0300}"),
    ('\u{1f54}', "\u{03c5}\u{0313}\u{0301}"),
    ('\u{1f56}', "\u{03c5}\u{0313}\u{0342}"),
    ('\u{1f80}', "\u{1f00}\u{03b9}"),
    ('\u{1f81}', "\u{1f01}\u{03b9}"),
    ('\u{1f82}', "\u{1f02}\u{03b9}"),
    ('\u{1f83}', "\u{1f03}\u{03b9}"),
    ('\u{1f84}', "\u{1f04}\u{03b9}"),
    ('\u{1f85}', "\u{1f05}\u{03b9}"),
    ('\u{1f86}', "\u{1f06}\u{03b9}"),
    ('\u{1f87}', "\u{1f07}\u{03b9}"),
    ('\u{1f88}', "\u{1f00}\u{03b9}"),
    ('\u{1f89}', "\u{1f01}\u{03b9}"),
    ('\u{1f8a}', "\u{1f02}\u{03b9}"),
    ('\u{1f8b}', "\u{1f03}\u{03b9}"),
    ('\u{1f8c}', "\u{1f04}\u{03b9}"),
    ('\u{1f8d}', "\u{1f05}\u{03b9}"),
    ('\u{1f8e}', "\u{1f06}\u{03b9}"),
    ('\u{1f8f}', "\u{1f07}\u{03b9}"),
    ('\u{1f90}', "\u{1f20}\u{03b9}"),
    ('\u{1f91}', "\u{1f21}\u{03b9}"),
    ('\u{1f92}', "\u{1f22}\u{03b9}"),
    ('\u{1f93}', "\u{1f23}\u{03b9}"),
    ('\u{1f94}', "\u{1f24}\u{03b9}"),
    ('\u{1f95}', "\u{1f25}\u{03b9}"),
    ('\u{1f96}', "\u{1f26}\u{03b9}"),
    ('\u{1f97}', "\u{1f27}\u{03b9}"),
    ('\u{1f98}', "\u{1f20}\u{03b9}"),
    ('\u{1f99}', "\u{1f21}\u{03b9}"),
    ('\u{1f9a}', "\u{1f22}\u{03b9}"),
    ('\u{1f9b}', "\u{1f23}\u{03b9}"),
    ('\u{1f9c}', "\u{1f24}\u{03b9}"),
    ('\u{1f9d}', "\u{1f25}\u{03b9}"),
    ('\u{1f9e}', "\u{1f26}\u{03b9}"),
    ('\u{1f9f}', "\u{1f27}\u{03b9}"),
    ('\u{1fa0}', "\u{1f60}\u{03b9}"),
    ('\u{1fa1}', "\u{1f61}\u{03b9}"),
    ('\u{1fa2}', "\u{1f62}\u{03b9}"),
    ('\u{1fa3}', "\u{1f63}\u{03b9}"),
    ('\u{1fa4}', "\u{1f64}\u{03b9}"),
    ('\u{1fa5}', "\u{1f65}\u{03b9}"),
    ('\u{1fa6}', "\u{1f66}\u{03b9}"),
    ('\u{1fa7}', "\u{1f67}\u{03b9}"),
    ('\u{1fa8}', "\u{1f60}\u{03b9}"),
    ('\u{1fa9}', "\u{1f61}\u{03b9}"),
    ('\u{1faa}', "\u{1f62}\u{03b9}"),
    ('\u{1fab}', "\u{1f63}\u{03b9}"),
    ('\u{1fac}', "\u{1f64}\u{03b9}"),
    ('\u{1fad}', "\u{1f65}\u{03b9}"),
    ('\u{1fae}', "\u{1f66}\u{03b9}"),
    ('\u{1faf}', "\u{1f67}\u{03b9}"),
    ('\u{1fb2}', "\u{1f70}\u{03b9}"),
    ('\u{1fb3}', "\u{03b1}\u{03b9}"),
    ('\u{1fb4}', "\u{03ac}\u{03b9}"),
    ('\u{1fb6}', "\u{03b1}\u{0342}"),
    ('\u{1fb7}', "\u{03b1}\u{0342}\u{03b9}"),
    ('\u{1fbc}', "\u{03b1}\u{03b9}"),
    ('\u{1fbe}', "\u{03b9}"),
    ('\u{1fc2}', "\u{1f74}\u{03b9}"),
    ('\u{1fc3}', "\u{03b7}\u{03b9}"),
    ('\u{1fc4}', "\u{03ae}\u{03b9}"),
    ('\u{1fc6}', "\u{03b7}\u{0342}"),
    ('\u{1fc7}', "\u{03b7}\u{0342}\u{03b9}"),
    ('\u{1fcc}', "\u{03b7}\u{03b9}"),
    ('\u{1fd2}', "\u{03b9}\u{0308}\u{0300}"),
    ('\u{1fd3}', "\u{03b9}\u{0308}\u{0301}"),
    ('\u{1fd6}', "\u{03b9}\u{0342}"),
    ('\u{1fd7}', "\u{03b9}\u{0308}\u{0342}"),
    ('\u{1fe2}', "\u{03c5}\u{0308}\u{0300}"),
    ('\u{1fe3}', "\u{03c5}\u{0308}\u{0301}"),
    ('\u{1fe4}', "\u{03c1}\u{0313}"),
    ('\u{1fe6}', "\u{03c5}\u{0342}"),
    ('\u{1fe7}', "\u{03c5}\u{0308}\u{0342}"),
    ('\u{1ff2}', "\u{1f7c}\u{03b9}"),
    ('\u{1ff3}', "\u{03c9}\u{03b9}"),
    ('\u{1ff4}', "\u{03ce}\u{03b9}"),
    ('\u{1ff6}', "\u{03c9}\u{0342}"),
    ('\u{1ff7}', "\u{03c9}\u{0342}\u{03b9}"),
    ('\u{1ffc}', "\u{03c9}\u{03b9}"),
    ('\u{ab70}', "\u{13a0}"),
    ('\u{ab71}', "\u{13a1}"),
    ('\u{ab72}', "\u{13a2}"),
    ('\u{ab73}', "\u{13a3}"),
    ('\u{ab74}', "\u{13a4}"),
    ('\u{ab75}', "\u{13a5}"),
    ('\u{ab76}', "\u{13a6}"),
    ('\u{ab77}', "\u{13a7}"),
    ('\u{ab78}', "\u{13a8}"),
    ('\u{ab79}', "\u{13a9}"),
    ('\u{ab7a}', "\u{13aa}"),
    ('\u{ab7b}', "\u{13ab}"),
    ('\u{ab7c}', "\u{13ac}"),
    ('\u{ab7d}', "\u{13ad}"),
    ('\u{ab7e}', "\u{13ae}"),
    ('\u{ab7f}', "\u{13af}"),
    ('\u{ab80}', "\u{13b0}"),
    ('\u{ab81}', "\u{13b1}"),
    ('\u{ab82}', "\u{13b2}"),
    ('\u{ab83}', "\u{13b3}"),
    ('\u{ab84}', "\u{13b4}"),
    ('\u{ab85}', "\u{13b5}"),
    ('\u{ab86}', "\u{13b6}"),
    ('\u{ab87}', "\u{13b7}"),
    ('\u{ab88}', "\u{13b8}"),
    ('\u{ab89}', "\u{13b9}"),
    ('\u{ab8a}', "\u{13ba}"),
    ('\u{ab8b}', "\u{13bb}"),
    ('\u{ab8c}', "\u{13bc}"),
    ('\u{ab8d}', "\u{13bd}"),
    ('\u{ab8e}', "\u{13be}"),
    ('\u{ab8f}', "\u{13bf}"),
    ('\u{ab90}', "\u{13c0}"),
    ('\u{ab91}', "\u{13c1}"),
    ('\u{ab92}', "\u{13c2}"),
    ('\u{ab93}', "\u{13c3}"),
    ('\u{ab94}', "\u{13c4}"),
    ('\u{ab95}', "\u{13c5}"),
    ('\u{ab96}', "\u{13c6}"),
    ('\u{ab97}', "\u{13c7}"),
    ('\u{ab98}', "\u{13c8}"),
    ('\u{ab99}', "\u{13c9}"),
    ('\u{ab9a}', "\u{13ca}"),
    ('\u{ab9b}', "\u{13cb}"),
    ('\u{ab9c}', "\u{13cc}"),
    ('\u{ab9d}', "\u{13cd}"),
    ('\u{ab9e}', "\u{13ce}"),
    ('\u{ab9f}', "\u{13cf}"),
    ('\u{aba0}', "\u{13d0}"),
    ('\u{aba1}', "\u{13d1}"),
    ('\u{aba2}', "\u{13d2}"),
    ('\u{aba3}', "\u{13d3}"),
    ('\u{aba4}', "\u{13d4}"),
    ('\u{aba5}', "\u{13d5}"),
    ('\u{aba6}', "\u{13d6}"),
    ('\u{aba7}', "\u{13d7}"),
    ('\u{aba8}', "\u{13d8}"),
    ('\u{aba9}', "\u{13d9}"),
    ('\u{abaa}', "\u{13da}"),
    ('\u{abab}', "\u{13db}"),
    ('\u{abac}', "\u{13dc}"),
    ('\u{abad}', "\u{13dd}"),
    ('\u{abae}', "\u{13de}"),
    ('\u{abaf}', "\u{13df}"),
    ('\u{abb0}', "\u{13e0}"),
    ('\u{abb1}', "\u{13e1}"),
    ('\u{abb2}', "\u{13e2}"),
    ('\u{abb3}', "\u{13e3}"),
    ('\u{abb4}', "\u{13e4}"),
    ('\u{abb5}', "\u{13e5}"),
    ('\u{abb6}', "\u{13e6}"),
    ('\u{abb7}', "\u{13e7}"),
    ('\u{abb8}', "\u{13e8}"),
    ('\u{abb9}', "\u{13e9}"),
    ('\u{abba}', "\u{13ea}"),
    ('\u{abbb}', "\u{13eb}"),
    ('\u{abbc}', "\u{13ec}"),
    ('\u{abbd}', "\u{13ed}"),
    ('\u{abbe}', "\u{13ee}"),
    ('\u{abbf}', "\u{13ef}"),
    ('\u{fb00}', "\u{0066}\u{0066}"),
    ('\u{fb01}', "\u{0066}\u{0069}"),
    ('\u{fb02}', "\u{0066}\u{006c}"),
    ('\u{fb03}', "\u{0066}\u{0066}\u{0069}"),
    ('\u{fb04}', "\u{0066}\u{0066}\u{006c}"),
    ('\u{fb05}', "\u{0073}\u{0074}"),
    ('\u{fb06}', "\u{0073}\u{0074}"),
    ('\u{fb13}', "\u{0574}\u{0576}"),
    ('\u{fb14}', "\u{0574}\u{0565}"),
    ('\u{fb15}', "\u{0574}\u{056b}"),
    ('\u{fb16}', "\u{057e}\u{0576}"),
    ('\u{fb17}', "\u{0574}\u{056d}"),
];

pub(super) fn casefold(value: &str) -> String {
    let mut folded = String::with_capacity(value.len());
    for character in value.chars() {
        let mapping = CASEFOLD_EXCEPTIONS
            .binary_search_by_key(&character, |(source, _)| *source)
            .ok()
            .map(|index| CASEFOLD_EXCEPTIONS[index].1);
        if let Some(mapping) = mapping {
            folded.push_str(mapping);
        } else {
            folded.extend(character.to_lowercase());
        }
    }
    folded
}

pub(super) fn normalize_entity_label(value: &str) -> String {
    let folded = casefold(value.trim());
    LABEL_SEPARATORS
        .replace_all(&folded, " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) fn sha1_digest(input: &[u8]) -> [u8; 20] {
    const INITIAL: [u32; 5] = [
        0x6745_2301,
        0xefcd_ab89,
        0x98ba_dcfe,
        0x1032_5476,
        0xc3d2_e1f0,
    ];

    fn process_block(state: &mut [u32; 5], block: &[u8; 64]) {
        let mut words = [0_u32; 80];
        for (index, chunk) in block.chunks_exact(4).enumerate() {
            words[index] = u32::from_be_bytes(chunk.try_into().expect("four-byte word"));
        }
        for index in 16..80 {
            words[index] =
                (words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16])
                    .rotate_left(1);
        }

        let [mut a, mut b, mut c, mut d, mut e] = *state;
        for (index, word) in words.into_iter().enumerate() {
            let (function, constant) = match index {
                0..=19 => ((b & c) | (!b & d), 0x5a82_7999),
                20..=39 => (b ^ c ^ d, 0x6ed9_eba1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8f1b_bcdc),
                _ => (b ^ c ^ d, 0xca62_c1d6),
            };
            let next = a
                .rotate_left(5)
                .wrapping_add(function)
                .wrapping_add(e)
                .wrapping_add(constant)
                .wrapping_add(word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = next;
        }
        state[0] = state[0].wrapping_add(a);
        state[1] = state[1].wrapping_add(b);
        state[2] = state[2].wrapping_add(c);
        state[3] = state[3].wrapping_add(d);
        state[4] = state[4].wrapping_add(e);
    }

    let bit_length = (input.len() as u64).wrapping_mul(8);
    let padded_length = input.len().saturating_add(9).div_ceil(64) * 64;
    let blocks = padded_length / 64;
    let mut state = INITIAL;
    for block_index in 0..blocks {
        let block_start = block_index * 64;
        let mut block = [0_u8; 64];
        if block_start < input.len() {
            let copied = (input.len() - block_start).min(64);
            block[..copied].copy_from_slice(&input[block_start..block_start + copied]);
        }
        if (block_start..block_start + 64).contains(&input.len()) {
            block[input.len() - block_start] = 0x80;
        }
        if block_index + 1 == blocks {
            block[56..].copy_from_slice(&bit_length.to_be_bytes());
        }
        process_block(&mut state, &block);
    }

    let mut digest = [0_u8; 20];
    for (chunk, word) in digest.chunks_exact_mut(4).zip(state) {
        chunk.copy_from_slice(&word.to_be_bytes());
    }
    digest
}

pub(super) fn hex_prefix(bytes: &[u8], byte_count: usize) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(byte_count * 2);
    for byte in bytes.iter().take(byte_count) {
        value.push(HEX[(byte >> 4) as usize] as char);
        value.push(HEX[(byte & 0x0f) as usize] as char);
    }
    value
}

pub(super) fn stable_source_id(source_name: &str) -> String {
    let normalized = normalize_entity_label(source_name);
    format!(
        "outlet:{}",
        hex_prefix(&sha1_digest(normalized.as_bytes()), 6)
    )
}

pub(super) fn edge_id(
    source_id: &str,
    target_id: &str,
    relation: &str,
    discriminator: &str,
) -> String {
    let raw = format!("{source_id}|{target_id}|{relation}|{discriminator}");
    format!("edge:{}", hex_prefix(&sha1_digest(raw.as_bytes()), 8))
}

pub(super) fn confidence_tier(value: Option<f64>) -> AtlasConfidenceTier {
    match value {
        Some(score) if score >= 0.9 => AtlasConfidenceTier::Verified,
        Some(score) if score >= 0.75 => AtlasConfidenceTier::Strong,
        Some(score) if score >= 0.5 => AtlasConfidenceTier::Likely,
        Some(_) => AtlasConfidenceTier::Unresolved,
        None => AtlasConfidenceTier::Unresolved,
    }
}
