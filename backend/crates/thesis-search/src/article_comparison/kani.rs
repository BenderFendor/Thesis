use super::{keyword_emphasis, KeywordEmphasis};

#[kani::proof]
fn keyword_emphasis_tracks_frequency_order() {
    let source_1 = kani::any::<u16>() as usize;
    let source_2 = kani::any::<u16>() as usize;
    let emphasis = keyword_emphasis(source_1, source_2);
    assert_eq!(emphasis == KeywordEmphasis::Source1, source_1 > source_2);
    assert_eq!(emphasis == KeywordEmphasis::Source2, source_1 < source_2);
    assert_eq!(emphasis == KeywordEmphasis::Equal, source_1 == source_2);
}
