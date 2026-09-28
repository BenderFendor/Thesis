use vstd::prelude::*;

verus! {

#[derive(Clone, Copy)]
pub struct Observation {
    pub root_id: nat,
    pub reviewed_entailing: bool,
    pub allowed_by_policy: bool,
}

pub open spec fn qualifies(observation: Observation) -> bool {
    observation.reviewed_entailing && observation.allowed_by_policy
}

pub open spec fn has_qualifying_root(evidence: Seq<Observation>, root: nat) -> bool {
    exists |index: int|
        0 <= index
            && index < evidence.len()
            && evidence[index].root_id == root
            && qualifies(evidence[index])
}

/// Repeated evidence from an existing root cannot increase independent support.
proof fn duplicate_root_preserves_independent_roots(
    evidence: Seq<Observation>,
    observation: Observation,
)
    requires
        qualifies(observation),
        has_qualifying_root(evidence, observation.root_id),
    ensures
        forall |root: nat|
            #[trigger] has_qualifying_root(evidence.push(observation), root)
                == has_qualifying_root(evidence, root),
{
    assert forall |root: nat|
        #[trigger] has_qualifying_root(evidence.push(observation), root)
            implies has_qualifying_root(evidence, root)
    by {
        if has_qualifying_root(evidence.push(observation), root) {
            let index = choose |index: int|
                0 <= index
                    && index < evidence.push(observation).len()
                    && evidence.push(observation)[index].root_id == root
                    && qualifies(evidence.push(observation)[index]);
            if index < evidence.len() {
                assert(evidence.push(observation)[index] == evidence[index]);
                assert(has_qualifying_root(evidence, root));
            } else {
                assert(index == evidence.len());
                assert(evidence.push(observation)[index] == observation);
                assert(root == observation.root_id);
                assert(has_qualifying_root(evidence, observation.root_id));
            }
        }
    }

    assert forall |root: nat|
        #[trigger] has_qualifying_root(evidence, root)
            implies has_qualifying_root(evidence.push(observation), root)
    by {
        if has_qualifying_root(evidence, root) {
            let index = choose |index: int|
                0 <= index
                    && index < evidence.len()
                    && evidence[index].root_id == root
                    && qualifies(evidence[index]);
            assert(index < evidence.push(observation).len());
            assert(evidence.push(observation)[index] == evidence[index]);
            assert(has_qualifying_root(evidence.push(observation), root));
        }
    }
}

fn main() { }

}
