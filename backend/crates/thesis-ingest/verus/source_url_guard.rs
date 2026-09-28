use vstd::prelude::*;

verus! {

/// Abstract label-boundary rule used by `source_url_guard::hosts_match`.
pub open spec fn domain_or_subdomain(host: Seq<u8>, domain: Seq<u8>) -> bool {
    host == domain
        || (host.len() > domain.len()
            && host.subrange((host.len() - domain.len()) as int, host.len() as int) == domain
            && host[(host.len() - domain.len() - 1) as int] == b'.')
}

/// Appending a domain matches it only when the prefix ends at a label boundary.
proof fn a_suffix_needs_a_label_separator(prefix: Seq<u8>, domain: Seq<u8>)
    requires prefix.len() > 0
    ensures domain_or_subdomain(prefix + domain, domain)
        == (prefix[(prefix.len() - 1) as int] == b'.')
{
    let host = prefix + domain;
    assert(host.len() == prefix.len() + domain.len());
    assert(host.len() > domain.len());
    assert(host.subrange(prefix.len() as int, (prefix.len() + domain.len()) as int) == domain);
    assert(host[(prefix.len() - 1) as int] == prefix[(prefix.len() - 1) as int]);
    assert(host != domain);
}

fn main() { }

}
