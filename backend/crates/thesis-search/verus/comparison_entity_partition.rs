use vstd::prelude::*;

verus! {

/// Relation of one normalized entity identity to two source articles.
pub enum EntityClass {
    /// The identity occurs in both sources.
    Shared,
    /// The identity occurs only in the first source.
    Source1Only,
    /// The identity occurs only in the second source.
    Source2Only,
    /// The identity occurs in neither source.
    Absent,
}

/// The three set-valued groups returned by article comparison.
pub struct EntityPartition {
    pub common: Set<nat>,
    pub unique_to_source_1: Set<nat>,
    pub unique_to_source_2: Set<nat>,
}

pub open spec fn classify_presence(in_source_1: bool, in_source_2: bool) -> EntityClass {
    if in_source_1 {
        if in_source_2 {
            EntityClass::Shared
        } else {
            EntityClass::Source1Only
        }
    } else if in_source_2 {
        EntityClass::Source2Only
    } else {
        EntityClass::Absent
    }
}

/// Model the production comparison over arbitrary finite sets of normalized IDs.
/// IDs abstract case-folded names; display spellings and output ordering are omitted.
pub open spec fn partition_entities(
    source_1: Set<nat>,
    source_2: Set<nat>,
) -> EntityPartition {
    EntityPartition {
        common: source_1.intersect(source_2),
        unique_to_source_1: source_1.difference(source_2),
        unique_to_source_2: source_2.difference(source_1),
    }
}

proof fn one_identity_is_partitioned_correctly(
    source_1: Set<nat>,
    source_2: Set<nat>,
    entity: nat,
)
    ensures
        source_1.contains(entity)
            == (partition_entities(source_1, source_2).common.contains(entity)
                || partition_entities(source_1, source_2)
                    .unique_to_source_1.contains(entity)),
        source_2.contains(entity)
            == (partition_entities(source_1, source_2).common.contains(entity)
                || partition_entities(source_1, source_2)
                    .unique_to_source_2.contains(entity)),
        !(partition_entities(source_1, source_2).common.contains(entity)
            && partition_entities(source_1, source_2)
                .unique_to_source_1.contains(entity)),
        !(partition_entities(source_1, source_2).common.contains(entity)
            && partition_entities(source_1, source_2)
                .unique_to_source_2.contains(entity)),
        !(partition_entities(source_1, source_2).unique_to_source_1.contains(entity)
            && partition_entities(source_1, source_2)
                .unique_to_source_2.contains(entity)),
{
    let partition = partition_entities(source_1, source_2);
    match classify_presence(source_1.contains(entity), source_2.contains(entity)) {
        EntityClass::Shared => {
            assert(partition.common.contains(entity));
            assert(!partition.unique_to_source_1.contains(entity));
            assert(!partition.unique_to_source_2.contains(entity));
        },
        EntityClass::Source1Only => {
            assert(!partition.common.contains(entity));
            assert(partition.unique_to_source_1.contains(entity));
            assert(!partition.unique_to_source_2.contains(entity));
        },
        EntityClass::Source2Only => {
            assert(!partition.common.contains(entity));
            assert(!partition.unique_to_source_1.contains(entity));
            assert(partition.unique_to_source_2.contains(entity));
        },
        EntityClass::Absent => {
            assert(!partition.common.contains(entity));
            assert(!partition.unique_to_source_1.contains(entity));
            assert(!partition.unique_to_source_2.contains(entity));
        },
    }
}

/// The output groups are pairwise disjoint and reconstruct both input sets.
pub proof fn partition_is_disjoint_and_reconstructs(
    source_1: Set<nat>,
    source_2: Set<nat>,
)
    ensures
        forall |entity: nat|
            source_1.contains(entity)
                == (partition_entities(source_1, source_2).common.contains(entity)
                    || partition_entities(source_1, source_2)
                        .unique_to_source_1.contains(entity)),
        forall |entity: nat|
            source_2.contains(entity)
                == (partition_entities(source_1, source_2).common.contains(entity)
                    || partition_entities(source_1, source_2)
                        .unique_to_source_2.contains(entity)),
        forall |entity: nat|
            !(partition_entities(source_1, source_2).common.contains(entity)
                && partition_entities(source_1, source_2)
                    .unique_to_source_1.contains(entity)),
        forall |entity: nat|
            !(partition_entities(source_1, source_2).common.contains(entity)
                && partition_entities(source_1, source_2)
                    .unique_to_source_2.contains(entity)),
        forall |entity: nat|
            !(partition_entities(source_1, source_2).unique_to_source_1.contains(entity)
                && partition_entities(source_1, source_2)
                    .unique_to_source_2.contains(entity)),
{
    assert forall |entity: nat|
        source_1.contains(entity)
            == (partition_entities(source_1, source_2).common.contains(entity)
                || partition_entities(source_1, source_2)
                    .unique_to_source_1.contains(entity))
        && source_2.contains(entity)
            == (partition_entities(source_1, source_2).common.contains(entity)
                || partition_entities(source_1, source_2)
                    .unique_to_source_2.contains(entity))
        && !(partition_entities(source_1, source_2).common.contains(entity)
            && partition_entities(source_1, source_2)
                .unique_to_source_1.contains(entity))
        && !(partition_entities(source_1, source_2).common.contains(entity)
            && partition_entities(source_1, source_2)
                .unique_to_source_2.contains(entity))
        && !(partition_entities(source_1, source_2).unique_to_source_1.contains(entity)
            && partition_entities(source_1, source_2)
                .unique_to_source_2.contains(entity))
    by {
        one_identity_is_partitioned_correctly(source_1, source_2, entity);
    }
}

fn main() { }

}
