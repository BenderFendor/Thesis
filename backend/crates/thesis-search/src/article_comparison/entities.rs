//! Entity extraction and cross-article entity partitioning.

use std::collections::HashSet;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

const MAX_ENTITIES: usize = 20;

static ENTITY_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b").expect("valid entity regex")
});
static DATE_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    [
        r"(?i)\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*,?\s+\w+\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4}?\b",
        r"(?i)\b\d{1,2}/\d{1,2}/\d{2,4}\b",
        r"(?i)\b\d{4}-\d{2}-\d{2}\b",
        r"(?i)\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4}?\b",
        r"(?i)\btoday\b|\byesterday\b|\bthis morning\b|\bthis afternoon\b|\blast night\b",
    ]
    .into_iter()
    .map(|pattern| Regex::new(pattern).expect("valid date regex"))
    .collect()
});

const COMMON_ENTITY_WORDS: &[&str] = &[
    "The",
    "A",
    "An",
    "In",
    "On",
    "At",
    "To",
    "For",
    "Of",
    "And",
    "Or",
    "But",
    "Is",
    "Are",
    "Was",
    "Were",
    "This",
    "That",
    "These",
    "Those",
    "It",
    "He",
    "She",
    "They",
    "We",
    "You",
    "I",
    "Me",
    "My",
    "Your",
    "Their",
    "His",
    "Her",
    "Its",
    "Our",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

const ORGANIZATION_INDICATORS: &[&str] = &[
    "corp",
    "inc",
    "ltd",
    "company",
    "organization",
    "association",
    "university",
    "institute",
    "foundation",
    "agency",
    "department",
    "administration",
];

const LOCATION_INDICATORS: &[&str] = &[
    "city",
    "county",
    "state",
    "country",
    "nation",
    "republic",
    "kingdom",
    "province",
    "region",
    "district",
    "avenue",
    "street",
    "boulevard",
];

const PERSON_INDICATORS: &[&str] = &[
    "Mr.",
    "Ms.",
    "Mrs.",
    "Dr.",
    "Prof.",
    "President",
    "Senator",
    "Representative",
    "Governor",
    "Mayor",
    "CEO",
    "Director",
    "Minister",
];

/// The extracted, ordered entity groups for one article.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ArticleEntities {
    /// People identified by title or role prefixes.
    pub persons: Vec<String>,
    /// Organizations identified by name shape or organization terms.
    pub organizations: Vec<String>,
    /// Locations identified by location terms.
    pub locations: Vec<String>,
    /// Dates matched by the comparison service's date patterns.
    pub dates: Vec<String>,
}

/// The common and unique entity groups across the two articles.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct EntityRelations {
    /// Entities present in both articles.
    pub common_entities: ArticleEntities,
    /// Entities present only in the first article.
    pub unique_to_source_1: ArticleEntities,
    /// Entities present only in the second article.
    pub unique_to_source_2: ArticleEntities,
}

pub(super) fn extract_entities(text: &str) -> ArticleEntities {
    let mut entities = ArticleEntities::default();
    let mut seen_exact = HashSet::new();
    for capture in ENTITY_PATTERN.find_iter(text) {
        let entity = capture.as_str();
        if entity.chars().count() <= 2
            || COMMON_ENTITY_WORDS.contains(&entity)
            || !seen_exact.insert(entity.to_owned())
        {
            continue;
        }
        match entity_group(entity, text, capture.start()) {
            Some(EntityKind::Person) => entities.persons.push(entity.to_owned()),
            Some(EntityKind::Organization) => entities.organizations.push(entity.to_owned()),
            Some(EntityKind::Location) => entities.locations.push(entity.to_owned()),
            None => {}
        }
    }

    for pattern in DATE_PATTERNS.iter() {
        entities.dates.extend(
            pattern
                .find_iter(text)
                .map(|matched| matched.as_str().to_owned()),
        );
    }
    dedupe_entity_groups(&mut entities);
    entities
}

#[derive(Clone, Copy)]
enum EntityKind {
    Person,
    Organization,
    Location,
}

fn entity_group(entity: &str, text: &str, position: usize) -> Option<EntityKind> {
    let lowered = entity.to_lowercase();
    if ORGANIZATION_INDICATORS
        .iter()
        .any(|indicator| lowered.contains(indicator))
    {
        return Some(EntityKind::Organization);
    }
    if LOCATION_INDICATORS
        .iter()
        .any(|indicator| lowered.contains(indicator))
    {
        return Some(EntityKind::Location);
    }
    let prefix: String = text[..position]
        .chars()
        .rev()
        .take(50)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    if PERSON_INDICATORS
        .iter()
        .any(|indicator| prefix.contains(indicator))
    {
        return Some(EntityKind::Person);
    }
    if entity.contains(' ') {
        return Some(EntityKind::Organization);
    }
    None
}

fn dedupe_entity_groups(entities: &mut ArticleEntities) {
    for group in [
        &mut entities.persons,
        &mut entities.organizations,
        &mut entities.locations,
        &mut entities.dates,
    ] {
        let mut seen_lower = HashSet::new();
        group.retain(|item| seen_lower.insert(item.to_lowercase()));
        group.truncate(MAX_ENTITIES);
    }
}

fn compare_entity_group(
    left: &[String],
    right: &[String],
) -> (Vec<String>, Vec<String>, Vec<String>) {
    let left_names: HashSet<String> = left.iter().map(|name| name.to_lowercase()).collect();
    let right_names: HashSet<String> = right.iter().map(|name| name.to_lowercase()).collect();
    let common: HashSet<&str> = left_names
        .intersection(&right_names)
        .map(String::as_str)
        .collect();
    let left_only: HashSet<&str> = left_names
        .difference(&right_names)
        .map(String::as_str)
        .collect();
    let right_only: HashSet<&str> = right_names
        .difference(&left_names)
        .map(String::as_str)
        .collect();

    (
        left.iter()
            .filter(|name| common.contains(name.to_lowercase().as_str()))
            .cloned()
            .collect(),
        left.iter()
            .filter(|name| left_only.contains(name.to_lowercase().as_str()))
            .cloned()
            .collect(),
        right
            .iter()
            .filter(|name| right_only.contains(name.to_lowercase().as_str()))
            .cloned()
            .collect(),
    )
}

pub(super) fn compare_entities(left: &ArticleEntities, right: &ArticleEntities) -> EntityRelations {
    let (common_persons, unique_persons_1, unique_persons_2) =
        compare_entity_group(&left.persons, &right.persons);
    let (common_organizations, unique_organizations_1, unique_organizations_2) =
        compare_entity_group(&left.organizations, &right.organizations);
    let (common_locations, unique_locations_1, unique_locations_2) =
        compare_entity_group(&left.locations, &right.locations);
    let (common_dates, unique_dates_1, unique_dates_2) =
        compare_entity_group(&left.dates, &right.dates);

    EntityRelations {
        common_entities: ArticleEntities {
            persons: common_persons,
            organizations: common_organizations,
            locations: common_locations,
            dates: common_dates,
        },
        unique_to_source_1: ArticleEntities {
            persons: unique_persons_1,
            organizations: unique_organizations_1,
            locations: unique_locations_1,
            dates: unique_dates_1,
        },
        unique_to_source_2: ArticleEntities {
            persons: unique_persons_2,
            organizations: unique_organizations_2,
            locations: unique_locations_2,
            dates: unique_dates_2,
        },
    }
}

pub(super) fn entity_count(entities: &ArticleEntities) -> usize {
    entities.persons.len()
        + entities.organizations.len()
        + entities.locations.len()
        + entities.dates.len()
}
