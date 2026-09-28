//! Exact, dependency-free ownership-interest graph kernel.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt;
use std::str::FromStr;

use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

pub const OWNERSHIP_ALGORITHM_VERSION: &str = "ownership-math/2.0";
pub const DEFAULT_MAX_INTEREST_PATHS: usize = 10_000;
pub const MAX_FRACTION_SCALE: u32 = 36;

/// Ownership interest kind; serde uses `economic` and `voting`.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum InterestType {
    Economic,
    Voting,
}
impl InterestType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Economic => "economic",
            Self::Voting => "voting",
        }
    }
}
impl fmt::Display for InterestType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
impl FromStr for InterestType {
    type Err = OwnershipMathError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "economic" => Ok(Self::Economic),
            "voting" => Ok(Self::Voting),
            _ => Err(OwnershipMathError::InvalidInterestType {
                value: value.to_owned(),
            }),
        }
    }
}
impl TryFrom<&str> for InterestType {
    type Error = OwnershipMathError;
    fn try_from(value: &str) -> Result<Self, Self::Error> {
        value.parse()
    }
}
impl TryFrom<String> for InterestType {
    type Error = OwnershipMathError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        value.parse()
    }
}

/// Validation, exact-arithmetic, and traversal safety errors.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum OwnershipMathError {
    InvalidOwnershipNumber { value: String },
    InvalidInterestType { value: String },
    NegativeOwnershipInterest,
    InvertedOwnershipRange,
    OwnershipInterestAboveOne,
    SummedOwnershipInterestAboveOne,
    ArithmeticOverflow { operation: String },
    OwnershipPathLimitExceeded { limit: usize },
}
impl fmt::Display for OwnershipMathError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidOwnershipNumber { value } => {
                write!(f, "invalid ownership number: {value:?}")
            }
            Self::InvalidInterestType { value } => {
                write!(f, "invalid ownership interest type: {value:?}")
            }
            Self::NegativeOwnershipInterest => {
                f.write_str("ownership interests cannot be negative")
            }
            Self::InvertedOwnershipRange => {
                f.write_str("ownership range lower bound exceeds upper bound")
            }
            Self::OwnershipInterestAboveOne => {
                f.write_str("ownership interests must be expressed from zero to one")
            }
            Self::SummedOwnershipInterestAboveOne => {
                f.write_str("summed ownership interest exceeds 100%")
            }
            Self::ArithmeticOverflow { operation } => write!(
                f,
                "ownership fraction arithmetic overflow during {operation}"
            ),
            Self::OwnershipPathLimitExceeded { limit } => {
                write!(f, "ownership path count exceeds safety limit {limit}")
            }
        }
    }
}
impl std::error::Error for OwnershipMathError {}

/// Exact decimal `mantissa / 10^scale`, normalized by removing zeroes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Fraction {
    pub mantissa: i128,
    pub scale: u32,
}
impl Fraction {
    pub fn new(mantissa: i128, scale: u32) -> Result<Self, OwnershipMathError> {
        if scale > MAX_FRACTION_SCALE {
            return Err(OwnershipMathError::InvalidOwnershipNumber {
                value: format!("{mantissa}e-{scale}"),
            });
        }
        Self::normalized(mantissa, scale)
    }
    pub const fn zero() -> Self {
        Self {
            mantissa: 0,
            scale: 0,
        }
    }
    pub const fn one() -> Self {
        Self {
            mantissa: 1,
            scale: 0,
        }
    }
    fn normalized(mut mantissa: i128, mut scale: u32) -> Result<Self, OwnershipMathError> {
        if mantissa == 0 {
            return Ok(Self::zero());
        }
        while scale > 0 && mantissa % 10 == 0 {
            mantissa /= 10;
            scale -= 1;
        }
        Ok(Self { mantissa, scale })
    }
    fn pow10(power: u32) -> Option<i128> {
        let mut value = 1_i128;
        for _ in 0..power {
            value = value.checked_mul(10)?;
        }
        Some(value)
    }
    pub fn divide_by_u32(self, divisor: u32) -> Result<Self, OwnershipMathError> {
        if divisor == 0 {
            return Err(Self::overflow("division by zero"));
        }
        let mut remainder = divisor;
        let mut twos = 0_u32;
        let mut fives = 0_u32;
        while remainder.is_multiple_of(2) {
            remainder /= 2;
            twos += 1;
        }
        while remainder.is_multiple_of(5) {
            remainder /= 5;
            fives += 1;
        }
        if remainder != 1 {
            return Err(Self::overflow("non-finite decimal division"));
        }
        let increment = twos.max(fives);
        let scale = self
            .scale
            .checked_add(increment)
            .ok_or_else(|| Self::overflow("decimal division scale"))?;
        if scale > MAX_FRACTION_SCALE {
            return Err(Self::overflow("decimal division scale"));
        }
        let mut mantissa = self.mantissa;
        for _ in 0..increment.saturating_sub(twos) {
            mantissa = mantissa
                .checked_mul(2)
                .ok_or_else(|| Self::overflow("decimal division"))?;
        }
        for _ in 0..increment.saturating_sub(fives) {
            mantissa = mantissa
                .checked_mul(5)
                .ok_or_else(|| Self::overflow("decimal division"))?;
        }
        Self::normalized(mantissa, scale)
    }
    fn overflow(operation: &str) -> OwnershipMathError {
        OwnershipMathError::ArithmeticOverflow {
            operation: operation.to_owned(),
        }
    }
    fn align(self, other: Self) -> Result<(i128, i128, u32), OwnershipMathError> {
        let scale = self.scale.max(other.scale);
        let left = self
            .mantissa
            .checked_mul(
                Self::pow10(scale - self.scale)
                    .ok_or_else(|| Self::overflow("decimal alignment"))?,
            )
            .ok_or_else(|| Self::overflow("decimal alignment"))?;
        let right = other
            .mantissa
            .checked_mul(
                Self::pow10(scale - other.scale)
                    .ok_or_else(|| Self::overflow("decimal alignment"))?,
            )
            .ok_or_else(|| Self::overflow("decimal alignment"))?;
        Ok((left, right, scale))
    }
    fn add(self, other: Self) -> Result<Self, OwnershipMathError> {
        let (left, right, scale) = self.align(other)?;
        Self::normalized(
            left.checked_add(right)
                .ok_or_else(|| Self::overflow("decimal addition"))?,
            scale,
        )
    }
    fn multiply(self, other: Self) -> Result<Self, OwnershipMathError> {
        let scale = self
            .scale
            .checked_add(other.scale)
            .ok_or_else(|| Self::overflow("decimal scale addition"))?;
        if scale > MAX_FRACTION_SCALE {
            return Err(Self::overflow("decimal multiplication scale"));
        }
        Self::normalized(
            self.mantissa
                .checked_mul(other.mantissa)
                .ok_or_else(|| Self::overflow("decimal multiplication"))?,
            scale,
        )
    }
    fn is_negative(self) -> bool {
        self.mantissa < 0
    }
    fn abs_digits(self) -> String {
        self.mantissa.unsigned_abs().to_string()
    }
    fn cmp_abs(self, other: Self) -> Ordering {
        match (self.mantissa == 0, other.mantissa == 0) {
            (true, true) => return Ordering::Equal,
            (true, false) => return Ordering::Less,
            (false, true) => return Ordering::Greater,
            (false, false) => {}
        }
        let left = self.abs_digits();
        let right = other.abs_digits();
        match (left.len() as i64 - i64::from(self.scale))
            .cmp(&(right.len() as i64 - i64::from(other.scale)))
        {
            Ordering::Equal => {
                for i in 0..left.len().max(right.len()) {
                    let l = left.as_bytes().get(i).copied().unwrap_or(b'0');
                    let r = right.as_bytes().get(i).copied().unwrap_or(b'0');
                    if l != r {
                        return l.cmp(&r);
                    }
                }
                Ordering::Equal
            }
            order => order,
        }
    }
    fn compare(self, other: Self) -> Ordering {
        match (self.is_negative(), other.is_negative()) {
            (true, false) => Ordering::Less,
            (false, true) => Ordering::Greater,
            (false, false) => self.cmp_abs(other),
            (true, true) => self.cmp_abs(other).reverse(),
        }
    }
    pub fn as_f64(self) -> f64 {
        self.mantissa as f64 / 10_f64.powi(self.scale as i32)
    }
}
impl Ord for Fraction {
    fn cmp(&self, other: &Self) -> Ordering {
        (*self).compare(*other)
    }
}
impl PartialOrd for Fraction {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl fmt::Display for Fraction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.mantissa == 0 {
            return f.write_str("0");
        }
        if self.mantissa < 0 {
            f.write_str("-")?;
        }
        let digits = self.abs_digits();
        let scale = self.scale as usize;
        if scale == 0 {
            return f.write_str(&digits);
        }
        if digits.len() <= scale {
            f.write_str("0.")?;
            for _ in 0..scale - digits.len() {
                f.write_str("0")?;
            }
            return f.write_str(&digits);
        }
        let split = digits.len() - scale;
        f.write_str(&digits[..split])?;
        f.write_str(".")?;
        f.write_str(&digits[split..])
    }
}
impl FromStr for Fraction {
    type Err = OwnershipMathError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        parse_decimal(value)
    }
}

fn parse_decimal(input: &str) -> Result<Fraction, OwnershipMathError> {
    let original = input.to_owned();
    let value = input.trim();
    if value.is_empty() {
        return Err(OwnershipMathError::InvalidOwnershipNumber { value: original });
    }
    let (coefficient, exponent) = match value.find(['e', 'E']) {
        Some(index) => (
            &value[..index],
            value[index + 1..].parse::<i32>().map_err(|_| {
                OwnershipMathError::InvalidOwnershipNumber {
                    value: original.clone(),
                }
            })?,
        ),
        None => (value, 0),
    };
    let (negative, coefficient) = match coefficient.as_bytes().first() {
        Some(b'-') => (true, &coefficient[1..]),
        Some(b'+') => (false, &coefficient[1..]),
        _ => (false, coefficient),
    };
    let (integer, fractional) = match coefficient.find('.') {
        Some(index) => (&coefficient[..index], &coefficient[index + 1..]),
        None => (coefficient, ""),
    };
    let digits = format!("{integer}{fractional}");
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(OwnershipMathError::InvalidOwnershipNumber { value: original });
    }
    let mut mantissa =
        digits
            .parse::<i128>()
            .map_err(|_| OwnershipMathError::InvalidOwnershipNumber {
                value: original.clone(),
            })?;
    if negative {
        mantissa =
            mantissa
                .checked_neg()
                .ok_or_else(|| OwnershipMathError::InvalidOwnershipNumber {
                    value: original.clone(),
                })?;
    }
    let scale = i64::try_from(fractional.len())
        .ok()
        .and_then(|n| n.checked_sub(i64::from(exponent)))
        .ok_or_else(|| OwnershipMathError::InvalidOwnershipNumber {
            value: original.clone(),
        })?;
    if scale < 0 {
        let factor = Fraction::pow10(u32::try_from(-scale).map_err(|_| {
            OwnershipMathError::InvalidOwnershipNumber {
                value: original.clone(),
            }
        })?)
        .ok_or_else(|| OwnershipMathError::InvalidOwnershipNumber {
            value: original.clone(),
        })?;
        mantissa = mantissa.checked_mul(factor).ok_or_else(|| {
            OwnershipMathError::InvalidOwnershipNumber {
                value: original.clone(),
            }
        })?;
        return Fraction::normalized(mantissa, 0)
            .map_err(|_| OwnershipMathError::InvalidOwnershipNumber { value: original });
    }
    let scale = u32::try_from(scale).map_err(|_| OwnershipMathError::InvalidOwnershipNumber {
        value: original.clone(),
    })?;
    if scale > MAX_FRACTION_SCALE {
        return Err(OwnershipMathError::InvalidOwnershipNumber { value: original });
    }
    Fraction::normalized(mantissa, scale)
        .map_err(|_| OwnershipMathError::InvalidOwnershipNumber { value: original })
}
impl Serialize for Fraction {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
struct FractionVisitor;
impl<'de> Visitor<'de> for FractionVisitor {
    type Value = Fraction;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a finite decimal number or decimal string")
    }
    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        value.parse().map_err(E::custom)
    }
    fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        value.parse().map_err(E::custom)
    }
    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.visit_str(&value.to_string())
    }
    fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.visit_str(&value.to_string())
    }
    fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.visit_str(&value.to_string())
    }
}
impl<'de> Deserialize<'de> for Fraction {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(FractionVisitor)
    }
}

/// A validated inclusive band with exact fractional fields.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct InterestRange {
    pub lower: Fraction,
    pub upper: Fraction,
}
pub trait FractionInput: ToString {}
impl<T: ToString> FractionInput for T {}
fn parse_fraction<T: FractionInput>(value: T) -> Result<Fraction, OwnershipMathError> {
    value.to_string().parse()
}
impl InterestRange {
    pub fn new<L: FractionInput, U: FractionInput>(
        lower: L,
        upper: U,
    ) -> Result<Self, OwnershipMathError> {
        let lower = parse_fraction(lower)?;
        let upper = parse_fraction(upper)?;
        if lower.is_negative() || upper.is_negative() {
            return Err(OwnershipMathError::NegativeOwnershipInterest);
        }
        if lower > upper {
            return Err(OwnershipMathError::InvertedOwnershipRange);
        }
        if upper > Fraction::one() {
            return Err(OwnershipMathError::OwnershipInterestAboveOne);
        }
        Ok(Self { lower, upper })
    }
    pub fn try_new<L: FractionInput, U: FractionInput>(
        lower: L,
        upper: U,
    ) -> Result<Self, OwnershipMathError> {
        Self::new(lower, upper)
    }
    pub fn point<T: FractionInput>(value: T) -> Result<Self, OwnershipMathError> {
        let value = parse_fraction(value)?;
        Self::new(value, value)
    }
    pub fn try_point<T: FractionInput>(value: T) -> Result<Self, OwnershipMathError> {
        Self::point(value)
    }
    pub fn from_fraction_str(value: &str) -> Result<Self, OwnershipMathError> {
        Self::point(value)
    }
    /// Convert percentage qualifiers such as `"25"` and `"50"` to exact fractions.
    pub fn from_percentages<L: FractionInput, U: FractionInput>(
        lower: L,
        upper: U,
    ) -> Result<Self, OwnershipMathError> {
        Self::new(
            parse_fraction(lower)?.divide_by_u32(100)?,
            parse_fraction(upper)?.divide_by_u32(100)?,
        )
    }
    pub fn multiply(&self, other: &Self) -> Result<Self, OwnershipMathError> {
        Self::new(
            self.lower.multiply(other.lower)?,
            self.upper.multiply(other.upper)?,
        )
    }
    pub fn add(&self, other: &Self) -> Result<Self, OwnershipMathError> {
        let lower = self.lower.add(other.lower)?;
        let upper = self.upper.add(other.upper)?;
        if upper > Fraction::one() {
            return Err(OwnershipMathError::SummedOwnershipInterestAboveOne);
        }
        Self::new(lower, upper)
    }
    pub fn as_percent(&self) -> PercentRange {
        PercentRange {
            lower: percent_value(self.lower),
            upper: percent_value(self.upper),
        }
    }
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub struct PercentRange {
    pub lower: f64,
    pub upper: f64,
}
fn percent_value(value: Fraction) -> f64 {
    (value.as_f64() * 1_000_000.0).round() / 10_000.0
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct OwnershipEdge {
    pub owner_id: String,
    pub owned_id: String,
    pub interest: InterestRange,
    pub interest_type: InterestType,
    #[serde(default)]
    pub security_class: Option<String>,
    #[serde(default = "default_true")]
    pub direct: bool,
    #[serde(default)]
    pub claim_id: Option<String>,
    #[serde(default)]
    pub disjoint_group: Option<String>,
}
fn default_true() -> bool {
    true
}
impl OwnershipEdge {
    pub fn new(
        owner_id: impl Into<String>,
        owned_id: impl Into<String>,
        interest: InterestRange,
        interest_type: InterestType,
    ) -> Self {
        Self {
            owner_id: owner_id.into(),
            owned_id: owned_id.into(),
            interest,
            interest_type,
            security_class: None,
            direct: true,
            claim_id: None,
            disjoint_group: None,
        }
    }
    pub fn with_claim_id(mut self, claim_id: impl Into<String>) -> Self {
        self.claim_id = Some(claim_id.into());
        self
    }
    pub fn with_security_class(mut self, value: impl Into<String>) -> Self {
        self.security_class = Some(value.into());
        self
    }
    pub const fn with_direct(mut self, direct: bool) -> Self {
        self.direct = direct;
        self
    }
    pub fn with_disjoint_group(mut self, value: impl Into<String>) -> Self {
        self.disjoint_group = Some(value.into());
        self
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct InterestPath {
    pub entity_ids: Vec<String>,
    pub claim_ids: Vec<String>,
    pub interest: InterestRange,
    pub disjoint_group: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct InterestPathTrace {
    pub entity_ids: Vec<String>,
    pub claim_ids: Vec<String>,
    pub interest: PercentRange,
    pub disjoint_group: Option<String>,
}
impl InterestPath {
    pub fn trace(&self) -> InterestPathTrace {
        InterestPathTrace {
            entity_ids: self.entity_ids.clone(),
            claim_ids: self.claim_ids.clone(),
            interest: self.interest.as_percent(),
            disjoint_group: self.disjoint_group.clone(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct InterestCalculation {
    pub owner_id: String,
    pub target_id: String,
    pub interest_type: InterestType,
    pub security_class: Option<String>,
    pub aggregate: Option<InterestRange>,
    pub paths: Vec<InterestPath>,
    pub possibly_overlapping: bool,
    pub cross_holding_unresolved: bool,
    pub algorithm_version: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct InterestCalculationTrace {
    pub algorithm_version: String,
    pub owner_id: String,
    pub target_id: String,
    pub interest_type: InterestType,
    pub security_class: Option<String>,
    pub aggregate: Option<PercentRange>,
    pub possibly_overlapping: bool,
    pub cross_holding_unresolved: bool,
    pub paths: Vec<InterestPathTrace>,
}
impl InterestCalculation {
    pub fn trace(&self) -> InterestCalculationTrace {
        InterestCalculationTrace {
            algorithm_version: self.algorithm_version.clone(),
            owner_id: self.owner_id.clone(),
            target_id: self.target_id.clone(),
            interest_type: self.interest_type,
            security_class: self.security_class.clone(),
            aggregate: self.aggregate.as_ref().map(InterestRange::as_percent),
            possibly_overlapping: self.possibly_overlapping,
            cross_holding_unresolved: self.cross_holding_unresolved,
            paths: self.paths.iter().map(InterestPath::trace).collect(),
        }
    }
}
impl Serialize for InterestCalculation {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        self.trace().serialize(serializer)
    }
}

fn relevant_edges<'a>(
    edges: &'a [OwnershipEdge],
    interest_type: InterestType,
    security_class: Option<&str>,
) -> Vec<&'a OwnershipEdge> {
    edges
        .iter()
        .filter(|edge| {
            edge.interest_type == interest_type
                && security_class.is_none_or(|class| edge.security_class.as_deref() == Some(class))
        })
        .collect()
}

/// Tarjan SCCs with sorted nodes, neighbors, and component members.
pub fn strongly_connected_components(edges: &[OwnershipEdge]) -> Vec<Vec<String>> {
    let refs: Vec<&OwnershipEdge> = edges.iter().collect();
    strongly_connected_components_refs(&refs)
}
fn strongly_connected_components_refs(edges: &[&OwnershipEdge]) -> Vec<Vec<String>> {
    let mut graph: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for &edge in edges {
        graph
            .entry(edge.owner_id.as_str())
            .or_default()
            .push(edge.owned_id.as_str());
        graph.entry(edge.owned_id.as_str()).or_default();
    }
    for values in graph.values_mut() {
        values.sort_unstable();
        values.dedup();
    }
    struct State<'a> {
        indices: HashMap<&'a str, usize>,
        low: HashMap<&'a str, usize>,
        stack: Vec<&'a str>,
        on_stack: HashSet<&'a str>,
        components: Vec<Vec<String>>,
    }
    fn visit<'a>(node: &'a str, graph: &BTreeMap<&'a str, Vec<&'a str>>, state: &mut State<'a>) {
        let index = state.indices.len();
        state.indices.insert(node, index);
        state.low.insert(node, index);
        state.stack.push(node);
        state.on_stack.insert(node);
        if let Some(neighbors) = graph.get(node) {
            for &neighbor in neighbors {
                if !state.indices.contains_key(neighbor) {
                    visit(neighbor, graph, state);
                    let low = state.low[neighbor];
                    let node_low = state.low[node].min(low);
                    state.low.insert(node, node_low);
                } else if state.on_stack.contains(neighbor) {
                    let index = state.indices[neighbor];
                    let node_low = state.low[node].min(index);
                    state.low.insert(node, node_low);
                }
            }
        }
        if state.low[node] == state.indices[node] {
            let mut component = Vec::new();
            loop {
                let member = state.stack.pop().unwrap();
                state.on_stack.remove(member);
                component.push(member.to_owned());
                if member == node {
                    break;
                }
            }
            component.sort_unstable();
            state.components.push(component);
        }
    }
    let mut state = State {
        indices: HashMap::new(),
        low: HashMap::new(),
        stack: Vec::new(),
        on_stack: HashSet::new(),
        components: Vec::new(),
    };
    for &node in graph.keys() {
        if !state.indices.contains_key(node) {
            visit(node, &graph, &mut state);
        }
    }
    state.components
}
fn has_cycle(edges: &[&OwnershipEdge]) -> bool {
    edges.iter().any(|edge| edge.owner_id == edge.owned_id)
        || strongly_connected_components_refs(edges)
            .iter()
            .any(|part| part.len() > 1)
}

#[derive(Clone, Copy)]
struct PathGroup<'a> {
    value: Option<&'a str>,
    conflict: bool,
}
fn update_group<'a>(group: PathGroup<'a>, candidate: Option<&'a str>) -> PathGroup<'a> {
    let Some(candidate) = candidate else {
        return group;
    };
    if group.conflict {
        return group;
    }
    match group.value {
        None => PathGroup {
            value: Some(candidate),
            conflict: false,
        },
        Some(existing) if existing == candidate => group,
        Some(_) => PathGroup {
            value: group.value,
            conflict: true,
        },
    }
}
fn enumerate_interest_paths(
    edges: &[&OwnershipEdge],
    owner_id: &str,
    target_id: &str,
    max_paths: usize,
) -> Result<Vec<InterestPath>, OwnershipMathError> {
    let mut adjacency: BTreeMap<&str, Vec<&OwnershipEdge>> = BTreeMap::new();
    for &edge in edges {
        adjacency
            .entry(edge.owner_id.as_str())
            .or_default()
            .push(edge);
    }
    for values in adjacency.values_mut() {
        values.sort_by(|a, b| {
            a.owned_id.cmp(&b.owned_id).then_with(|| {
                a.claim_id
                    .as_deref()
                    .unwrap_or("")
                    .cmp(b.claim_id.as_deref().unwrap_or(""))
            })
        });
    }
    struct PathState {
        entities: Vec<String>,
        claims: Vec<String>,
        paths: Vec<InterestPath>,
    }
    fn walk<'a>(
        current: &str,
        target: &str,
        adjacency: &BTreeMap<&'a str, Vec<&'a OwnershipEdge>>,
        max: usize,
        state: &mut PathState,
        interest: InterestRange,
        group: PathGroup<'a>,
    ) -> Result<(), OwnershipMathError> {
        if state.paths.len() >= max {
            return Err(OwnershipMathError::OwnershipPathLimitExceeded { limit: max });
        }
        if current == target {
            state.paths.push(InterestPath {
                entity_ids: state.entities.clone(),
                claim_ids: state.claims.clone(),
                interest,
                disjoint_group: (!group.conflict)
                    .then_some(group.value)
                    .flatten()
                    .map(str::to_owned),
            });
            return Ok(());
        }
        if let Some(next) = adjacency.get(current) {
            for &edge in next {
                if state.entities.iter().any(|id| id == &edge.owned_id) {
                    continue;
                }
                state.entities.push(edge.owned_id.clone());
                let claim_added = edge.claim_id.as_deref();
                if let Some(claim) = claim_added {
                    state.claims.push(claim.to_owned());
                }
                let result = walk(
                    &edge.owned_id,
                    target,
                    adjacency,
                    max,
                    state,
                    interest.multiply(&edge.interest)?,
                    update_group(group, edge.disjoint_group.as_deref()),
                );
                if claim_added.is_some() {
                    state.claims.pop();
                }
                state.entities.pop();
                result?;
            }
        }
        Ok(())
    }
    let mut state = PathState {
        entities: vec![owner_id.to_owned()],
        claims: Vec::new(),
        paths: Vec::new(),
    };
    walk(
        owner_id,
        target_id,
        &adjacency,
        max_paths,
        &mut state,
        InterestRange::point("1").unwrap(),
        PathGroup {
            value: None,
            conflict: false,
        },
    )?;
    Ok(state.paths)
}

/// Compute safe owner-to-target economic/voting interest.
pub fn compute_indirect_interest(
    edges: &[OwnershipEdge],
    owner_id: impl AsRef<str>,
    target_id: impl AsRef<str>,
    interest_type: InterestType,
    security_class: Option<&str>,
    max_paths: usize,
) -> Result<InterestCalculation, OwnershipMathError> {
    let owner_id = owner_id.as_ref().to_owned();
    let target_id = target_id.as_ref().to_owned();
    let relevant = relevant_edges(edges, interest_type, security_class);
    let base = || InterestCalculation {
        owner_id: owner_id.clone(),
        target_id: target_id.clone(),
        interest_type,
        security_class: security_class.map(str::to_owned),
        aggregate: None,
        paths: Vec::new(),
        possibly_overlapping: false,
        cross_holding_unresolved: false,
        algorithm_version: OWNERSHIP_ALGORITHM_VERSION.to_owned(),
    };
    if has_cycle(&relevant) {
        let mut result = base();
        result.cross_holding_unresolved = true;
        return Ok(result);
    }
    let paths = enumerate_interest_paths(&relevant, &owner_id, &target_id, max_paths)?;
    if paths.is_empty() {
        let mut result = base();
        result.paths = paths;
        return Ok(result);
    }
    if paths.len() == 1 {
        let mut result = base();
        result.aggregate = Some(paths[0].interest);
        result.paths = paths;
        return Ok(result);
    }
    let mut groups = HashSet::with_capacity(paths.len());
    if !paths.iter().all(|path| {
        path.disjoint_group
            .as_deref()
            .is_some_and(|group| groups.insert(group))
    }) {
        let mut result = base();
        result.paths = paths;
        result.possibly_overlapping = true;
        return Ok(result);
    }
    let mut aggregate = InterestRange::point("0").unwrap();
    for path in &paths {
        aggregate = aggregate.add(&path.interest)?;
    }
    let mut result = base();
    result.aggregate = Some(aggregate);
    result.paths = paths;
    Ok(result)
}
pub fn compute_indirect_interest_default(
    edges: &[OwnershipEdge],
    owner_id: impl AsRef<str>,
    target_id: impl AsRef<str>,
    interest_type: InterestType,
) -> Result<InterestCalculation, OwnershipMathError> {
    compute_indirect_interest(
        edges,
        owner_id,
        target_id,
        interest_type,
        None,
        DEFAULT_MAX_INTEREST_PATHS,
    )
}

#[cfg(test)]
#[path = "ownership_tests.rs"]
mod tests;
