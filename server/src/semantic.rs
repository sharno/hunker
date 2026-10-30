use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    sync::OnceLock,
};

use ast_grep_core::tree_sitter::StrDoc;
use ast_grep_core::{AstGrep, Doc, Node};
use ast_grep_language::SupportLang;
use regex::Regex;
use serde::Serialize;

use crate::{
    language::{self, LanguageSpec},
    source_presentation::{self, FilePresentation, FoldSeed, SourcePresentationResult},
    types::{FilePair, FileStatus, RelativePath, Side, SourceRange},
};

#[derive(Debug, Clone)]
struct AstUnit {
    kind: String,
    label: String,
    range: SourceRange,
    exact_fingerprint: String,
    label_fingerprint: String,
    shape_fingerprint: String,
    preview: String,
    byte_len: usize,
    order: usize,
    primary: bool,
}

/// Whether Tree-sitter recovered from syntax errors while parsing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TreeState {
    Complete,
    Incomplete,
}

#[derive(Debug)]
struct Parsed {
    state: TreeState,
    fingerprint: String,
    units: Vec<AstUnit>,
    language: &'static LanguageSpec,
    source: String,
    tree: tree_sitter::Tree,
}

impl Parsed {
    fn presentation(&self) -> SourcePresentationResult {
        source_presentation::build(
            self.language,
            &self.source,
            &self.tree,
            self.units.iter().map(|unit| FoldSeed {
                kind: unit.kind.clone(),
                label: unit.label.clone(),
                start_line: unit.range.start_line,
                end_line: unit.range.end_line,
            }),
        )
    }
}

#[derive(Debug)]
enum PreparedFile {
    Unsupported {
        path: RelativePath,
    },
    Supported {
        path: RelativePath,
        status: FileStatus,
        before: Box<Parsed>,
        after: Box<Parsed>,
    },
}

impl PreparedFile {
    fn new(file: &FilePair) -> Self {
        match LanguageSpec::for_path(file.path.as_str()) {
            None => Self::Unsupported {
                path: file.path.clone(),
            },
            Some(language) => Self::Supported {
                path: file.path.clone(),
                status: file.status.clone(),
                before: Box::new(parse_units(language, &file.old_text)),
                after: Box::new(parse_units(language, &file.new_text)),
            },
        }
    }

    fn path(&self) -> &RelativePath {
        match self {
            Self::Unsupported { path } | Self::Supported { path, .. } => path,
        }
    }

    fn presentation(&self) -> FilePresentation {
        match self {
            Self::Unsupported { .. } => FilePresentation {
                old: source_presentation::unsupported(),
                new: source_presentation::unsupported(),
            },
            Self::Supported { before, after, .. } => FilePresentation {
                old: before.presentation(),
                new: after.presentation(),
            },
        }
    }
}

/// Every file of one review parsed once; semantic results, syntax
/// presentation, and move detection all read this forest.
#[derive(Debug)]
pub struct PreparedReview {
    files: Vec<PreparedFile>,
}

impl PreparedReview {
    pub fn new(files: &[FilePair]) -> Self {
        Self {
            files: files.iter().map(PreparedFile::new).collect(),
        }
    }

    pub fn file_results(&self) -> Vec<(RelativePath, SemanticResult)> {
        self.files
            .iter()
            .map(|file| (file.path().clone(), analyze_prepared_file(file)))
            .collect()
    }

    pub fn moves(&self) -> Vec<MovedBlock> {
        analyze_prepared_review(&self.files)
    }

    pub fn file_presentations(&self) -> Vec<(RelativePath, FilePresentation)> {
        self.files
            .iter()
            .map(|file| (file.path().clone(), file.presentation()))
            .collect()
    }

    pub fn file_presentation(&self, path: &RelativePath) -> Option<FilePresentation> {
        self.files
            .iter()
            .find(|file| file.path() == path)
            .map(PreparedFile::presentation)
    }
}

type SgNode<'a> = Node<'a, StrDoc<SupportLang>>;

fn declaration(kind: &str) -> bool {
    matches!(
        kind,
        "class_declaration"
            | "class_definition"
            | "decorated_definition"
            | "enum_declaration"
            | "function_declaration"
            | "function_definition"
            | "interface_declaration"
            | "lexical_declaration"
            | "type_alias_declaration"
            | "variable_declaration"
            | "const_item"
            | "enum_item"
            | "foreign_mod_item"
            | "function_item"
            | "function_signature_item"
            | "impl_item"
            | "macro_definition"
            | "mod_item"
            | "static_item"
            | "struct_item"
            | "trait_item"
            | "type_item"
            | "union_item"
            | "assignment"
            | "attribute"
            | "block"
    )
}
fn member(kind: &str) -> bool {
    matches!(
        kind,
        "abstract_method_signature"
            | "method_definition"
            | "method_signature"
            | "public_field_definition"
            | "associated_type"
            | "const_item"
            | "function_item"
            | "function_signature_item"
            | "function_definition"
            | "type_item"
            | "attribute"
            | "block"
    )
}
fn container(kind: &str) -> bool {
    matches!(
        kind,
        "class_declaration"
            | "class_definition"
            | "impl_item"
            | "interface_declaration"
            | "mod_item"
            | "trait_item"
            | "block"
    )
}
fn identifier(kind: &str) -> bool {
    matches!(
        kind,
        "identifier"
            | "private_property_identifier"
            | "property_identifier"
            | "shorthand_property_identifier"
            | "type_identifier"
            | "field_identifier"
    )
}

fn leaf_tokens<D: Doc>(node: &Node<'_, D>, shape: bool, tokens: &mut Vec<String>) {
    let kind = node.kind().into_owned();
    if kind.contains("comment") {
        return;
    }
    let children = node.children().collect::<Vec<_>>();
    if children.is_empty() {
        static LITERAL_KIND: OnceLock<Regex> = OnceLock::new();
        let literal = LITERAL_KIND.get_or_init(|| {
            Regex::new(r"(?:bool|boolean|char|float|integer|number|numeric|string|template|regex|true|false|null|undefined)")
                .expect("literal-kind expression is valid")
        });
        let text = if shape && identifier(&kind) {
            "$identifier".to_owned()
        } else if shape && literal.is_match(&kind) {
            "$literal".to_owned()
        } else {
            node.text().into_owned()
        };
        tokens.push(format!("{kind}:{text}"));
    } else {
        for child in children {
            leaf_tokens(&child, shape, tokens);
        }
    }
}

fn node_label(node: &SgNode<'_>) -> String {
    if node.kind() == "block" {
        let labels = node
            .children()
            .filter(|child| matches!(child.kind().as_ref(), "identifier" | "string_lit"))
            .map(|child| child.text().trim_matches('"').to_owned())
            .collect::<Vec<_>>();
        if let Some((first, rest)) = labels.split_first() {
            return if rest.is_empty() {
                first.clone()
            } else {
                format!("{first} {}", rest.join("."))
            };
        }
    }
    if node.kind() == "decorated_definition"
        && let Some(definition) = node.children().find(|child| {
            matches!(
                child.kind().as_ref(),
                "class_definition" | "function_definition"
            )
        })
    {
        return node_label(&definition);
    }
    let mut queue = node.children().collect::<VecDeque<_>>();
    while let Some(current) = queue.pop_front() {
        if identifier(current.kind().as_ref()) {
            return current.text().into_owned();
        }
        queue.extend(current.children());
    }
    node.kind().replace('_', " ")
}

fn preview(node: SgNode<'_>) -> String {
    let preview_node = if node.kind() == "decorated_definition" {
        node.children()
            .find(|child| {
                matches!(
                    child.kind().as_ref(),
                    "class_definition" | "function_definition"
                )
            })
            .unwrap_or_else(|| node.clone())
    } else {
        node
    };
    preview_node
        .text()
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim()
        .chars()
        .take(100)
        .collect()
}

fn source_range(node: &SgNode<'_>) -> SourceRange {
    let start = node.start_pos();
    let end = node.end_pos();
    SourceRange {
        start_line: start.line() + 1,
        end_line: end.line() + 1,
        start_column: start.column(node) + 1,
        end_column: end.column(node) + 1,
    }
}

fn collect_units(root: &SgNode<'_>) -> Vec<AstUnit> {
    fn visit(node: &SgNode<'_>, inside_container: bool, units: &mut Vec<AstUnit>) {
        let kind = node.kind().into_owned();
        if declaration(&kind) || (inside_container && member(&kind)) {
            let mut exact = Vec::new();
            leaf_tokens(node, false, &mut exact);
            let mut shape = Vec::new();
            leaf_tokens(node, true, &mut shape);
            let label = node_label(node);
            units.push(AstUnit {
                kind: kind.clone(),
                label_fingerprint: format!("{kind}|{label}"),
                label,
                range: source_range(node),
                exact_fingerprint: format!("{kind}|{}", exact.join("|")),
                shape_fingerprint: format!("{kind}|{}", shape.join("|")),
                preview: preview(node.clone()),
                byte_len: node.text().len(),
                order: units.len(),
                primary: !inside_container,
            });
            if !container(&kind) {
                return;
            }
        }
        for child in node.children() {
            visit(&child, inside_container || container(&kind), units);
        }
    }
    let mut units = Vec::new();
    visit(root, false, &mut units);
    units
}

fn parse_units(language: &'static LanguageSpec, source: &str) -> Parsed {
    let document = StrDoc::new(source, language.grammar);
    let tree = document.tree.clone();
    let source = document.src.clone();
    let grep = AstGrep::doc(document);
    let root = grep.root();
    let state = if root
        .dfs()
        .any(|node| node.is_error() || node.kind() == "ERROR")
    {
        TreeState::Incomplete
    } else {
        TreeState::Complete
    };
    let mut fingerprint = Vec::new();
    leaf_tokens(&root, false, &mut fingerprint);
    Parsed {
        state,
        fingerprint: fingerprint.join("|"),
        units: collect_units(&root),
        language,
        source,
        tree,
    }
}

pub fn source_presentation(path: &str, source: &str) -> SourcePresentationResult {
    LanguageSpec::for_path(path).map_or_else(source_presentation::unsupported, |language| {
        parse_units(language, source).presentation()
    })
}

/// The result of pairing items whose key is unique on both sides.
struct Pairing<T> {
    pairs: Vec<(T, T)>,
    old_rest: Vec<T>,
    new_rest: Vec<T>,
}

/// Pairs old and new items that share a key occurring exactly once on each
/// side. Pairs keep old-side order so results are deterministic.
fn pair_unique<'k, T: Copy>(old: &[T], new: &[T], key: impl Fn(T) -> &'k str) -> Pairing<T> {
    fn unique<'k, T: Copy>(
        items: &[T],
        key: &impl Fn(T) -> &'k str,
    ) -> HashMap<&'k str, Option<usize>> {
        items
            .iter()
            .enumerate()
            .fold(HashMap::new(), |mut keys, (index, item)| {
                keys.entry(key(*item))
                    .and_modify(|slot| *slot = None)
                    .or_insert(Some(index));
                keys
            })
    }
    let new_keys = unique(new, &key);
    let matches = unique(old, &key)
        .into_iter()
        .filter_map(|(value, old_index)| Some((old_index?, (*new_keys.get(value)?)?)))
        .collect::<BTreeMap<_, _>>();
    let paired_new = matches.values().copied().collect::<HashSet<_>>();
    Pairing {
        pairs: matches
            .iter()
            .map(|(old_index, new_index)| (old[*old_index], new[*new_index]))
            .collect(),
        old_rest: old
            .iter()
            .enumerate()
            .filter(|(index, _)| !matches.contains_key(index))
            .map(|(_, item)| *item)
            .collect(),
        new_rest: new
            .iter()
            .enumerate()
            .filter(|(index, _)| !paired_new.contains(index))
            .map(|(_, item)| *item)
            .collect(),
    }
}

#[cfg(test)]
pub fn analyze_file(file: &FilePair) -> SemanticResult {
    analyze_prepared_file(&PreparedFile::new(file))
}

fn primary(parsed: &Parsed) -> Vec<&AstUnit> {
    parsed.units.iter().filter(|unit| unit.primary).collect()
}

fn analyze_prepared_file(file: &PreparedFile) -> SemanticResult {
    let PreparedFile::Supported { before, after, .. } = file else {
        return SemanticResult::Unsupported {
            reason: format!(
                "ast-grep semantic analysis currently supports {}.",
                language::supported_names()
            ),
        };
    };
    let language = before.language.name.to_owned();
    if before.state == TreeState::Incomplete || after.state == TreeState::Incomplete {
        return SemanticResult::ParseFailed {
            language,
            reason: "ast-grep found an incomplete syntax tree, so the regular patch is shown."
                .to_owned(),
        };
    }
    let identical = pair_unique(&primary(before), &primary(after), |unit| {
        unit.exact_fingerprint.as_str()
    });
    let updated = pair_unique(&identical.old_rest, &identical.new_rest, |unit| {
        unit.label_fingerprint.as_str()
    });
    let renamed = pair_unique(&updated.old_rest, &updated.new_rest, |unit| {
        unit.shape_fingerprint.as_str()
    });
    let changes = updated
        .pairs
        .into_iter()
        .map(|(old, new)| SemanticChange::Updated {
            kind: old.kind.clone(),
            label: old.label.clone(),
            old_range: old.range.clone(),
            new_range: new.range.clone(),
        })
        .chain(
            renamed
                .pairs
                .into_iter()
                .map(|(old, new)| SemanticChange::Renamed {
                    kind: old.kind.clone(),
                    old_label: old.label.clone(),
                    new_label: new.label.clone(),
                    old_range: old.range.clone(),
                    new_range: new.range.clone(),
                }),
        )
        .chain(
            renamed
                .old_rest
                .into_iter()
                .map(|unit| SemanticChange::Deleted {
                    kind: unit.kind.clone(),
                    label: unit.label.clone(),
                    old_range: unit.range.clone(),
                }),
        )
        .chain(
            renamed
                .new_rest
                .into_iter()
                .map(|unit| SemanticChange::Inserted {
                    kind: unit.kind.clone(),
                    label: unit.label.clone(),
                    new_range: unit.range.clone(),
                }),
        )
        .collect();
    SemanticResult::Parsed {
        language,
        semantic_equal: before.fingerprint == after.fingerprint,
        changes,
    }
}

#[derive(Debug, Clone, Copy)]
struct LocatedUnit<'a> {
    unit: &'a AstUnit,
    path: &'a RelativePath,
    file_index: usize,
}

fn located_units(files: &[PreparedFile], side: Side) -> Vec<LocatedUnit<'_>> {
    files
        .iter()
        .enumerate()
        .filter_map(|(file_index, file)| match file {
            PreparedFile::Supported {
                path,
                status,
                before,
                after,
            } if !crate::diff::generated(path.as_str()) => {
                let parsed = match side {
                    Side::Old => before,
                    Side::New => after,
                };
                let located_path = match (side, status) {
                    (Side::Old, FileStatus::Renamed { previous_path }) => previous_path,
                    (Side::Old, FileStatus::Modified | FileStatus::Added | FileStatus::Deleted)
                    | (Side::New, _) => path,
                };
                (parsed.state == TreeState::Complete).then_some((file_index, located_path, parsed))
            }
            PreparedFile::Supported { .. } | PreparedFile::Unsupported { .. } => None,
        })
        .flat_map(|(file_index, path, parsed)| {
            parsed.units.iter().map(move |unit| LocatedUnit {
                unit,
                path,
                file_index,
            })
        })
        .collect()
}

#[cfg(test)]
pub fn analyze_review(files: &[FilePair]) -> Vec<MovedBlock> {
    PreparedReview::new(files).moves()
}

/// Exact moves are found first; the remaining units are then matched by
/// shape to find blocks that moved and were edited.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MoveMatch {
    Exact,
    Changed,
}

impl MoveMatch {
    fn key(self, unit: &AstUnit) -> &str {
        match self {
            Self::Exact => &unit.exact_fingerprint,
            Self::Changed => &unit.shape_fingerprint,
        }
    }
}

fn analyze_prepared_review(files: &[PreparedFile]) -> Vec<MovedBlock> {
    let exact = pair_unique(
        &located_units(files, Side::Old),
        &located_units(files, Side::New),
        |located| MoveMatch::Exact.key(located.unit),
    );
    let changed = pair_unique(&exact.old_rest, &exact.new_rest, |located| {
        MoveMatch::Changed.key(located.unit)
    });
    let exact_moves = moves_from(MoveMatch::Exact, exact.pairs, Vec::new());
    moves_from(MoveMatch::Changed, changed.pairs, exact_moves)
}

/// Turns matched pairs into moves, largest blocks first, so a nested unit
/// that moved with its parent is reported once through the parent.
fn moves_from(
    kind: MoveMatch,
    mut pairs: Vec<(LocatedUnit<'_>, LocatedUnit<'_>)>,
    found: Vec<MovedBlock>,
) -> Vec<MovedBlock> {
    pairs.sort_by_key(|(old, _)| std::cmp::Reverse(old.unit.byte_len));
    let stable = match kind {
        MoveMatch::Exact => stable_in_file(&pairs),
        MoveMatch::Changed => HashSet::new(),
    };
    pairs
        .into_iter()
        .enumerate()
        .filter(|(index, (old, new))| {
            old.file_index != new.file_index
                || (kind == MoveMatch::Exact && !stable.contains(index))
        })
        .fold(found, |mut moves, (_, (old, new))| {
            if !moves.iter().any(|movement| movement.contains(old, new)) {
                moves.push(MovedBlock::new(kind, old, new));
            }
            moves
        })
}

/// Indexes of same-file pairs that keep their relative order: the longest
/// increasing subsequence of new positions. Only the others were reordered.
fn stable_in_file(pairs: &[(LocatedUnit<'_>, LocatedUnit<'_>)]) -> HashSet<usize> {
    pairs
        .iter()
        .enumerate()
        .filter(|(_, (old, new))| old.file_index == new.file_index)
        .fold(
            BTreeMap::<usize, Vec<(usize, usize, usize)>>::new(),
            |mut by_file, (index, (old, new))| {
                by_file.entry(old.file_index).or_default().push((
                    index,
                    old.unit.order,
                    new.unit.order,
                ));
                by_file
            },
        )
        .into_values()
        .flat_map(|mut file_pairs| {
            file_pairs.sort_by_key(|(_, old_order, _)| *old_order);
            let new_orders = file_pairs
                .iter()
                .map(|(_, _, new_order)| *new_order)
                .collect::<Vec<_>>();
            longest_increasing(&new_orders)
                .into_iter()
                .map(move |position| file_pairs[position].0)
        })
        .collect()
}

fn longest_increasing(values: &[usize]) -> HashSet<usize> {
    let mut tails = Vec::new();
    let mut previous = vec![None; values.len()];
    for (index, value) in values.iter().copied().enumerate() {
        let position = tails.partition_point(|tail_index| values[*tail_index] < value);
        previous[index] = position
            .checked_sub(1)
            .and_then(|previous_position| tails.get(previous_position).copied());
        if position == tails.len() {
            tails.push(index);
        } else {
            tails[position] = index;
        }
    }
    std::iter::successors(tails.last().copied(), |index| previous[*index]).collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "_tag")]
pub enum SemanticResult {
    Parsed {
        language: String,
        #[serde(rename = "semanticEqual")]
        semantic_equal: bool,
        changes: Vec<SemanticChange>,
    },
    Unsupported {
        reason: String,
    },
    ParseFailed {
        language: String,
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "_tag")]
pub enum SemanticChange {
    Inserted {
        kind: String,
        label: String,
        #[serde(rename = "newRange")]
        new_range: SourceRange,
    },
    Deleted {
        kind: String,
        label: String,
        #[serde(rename = "oldRange")]
        old_range: SourceRange,
    },
    Updated {
        kind: String,
        label: String,
        #[serde(rename = "oldRange")]
        old_range: SourceRange,
        #[serde(rename = "newRange")]
        new_range: SourceRange,
    },
    Renamed {
        kind: String,
        #[serde(rename = "oldLabel")]
        old_label: String,
        #[serde(rename = "newLabel")]
        new_label: String,
        #[serde(rename = "oldRange")]
        old_range: SourceRange,
        #[serde(rename = "newRange")]
        new_range: SourceRange,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovedBlock {
    pub from_path: RelativePath,
    pub to_path: RelativePath,
    pub from_line: usize,
    pub to_line: usize,
    pub from_line_count: usize,
    pub to_line_count: usize,
    pub preview: String,
    pub kind: String,
    pub label: String,
    #[serde(rename = "match")]
    pub matched: MoveMatch,
}

impl MovedBlock {
    fn new(matched: MoveMatch, old: LocatedUnit<'_>, new: LocatedUnit<'_>) -> Self {
        Self {
            from_path: old.path.clone(),
            to_path: new.path.clone(),
            from_line: old.unit.range.start_line,
            to_line: new.unit.range.start_line,
            from_line_count: old.unit.range.line_count(),
            to_line_count: new.unit.range.line_count(),
            preview: old.unit.preview.clone(),
            kind: old.unit.kind.clone(),
            label: match matched {
                MoveMatch::Exact => old.unit.label.clone(),
                MoveMatch::Changed => format!("{} → {}", old.unit.label, new.unit.label),
            },
            matched,
        }
    }

    fn contains(&self, old: LocatedUnit<'_>, new: LocatedUnit<'_>) -> bool {
        self.from_path == *old.path
            && self.to_path == *new.path
            && old.unit.range.start_line >= self.from_line
            && old.unit.range.end_line < self.from_line + self.from_line_count
            && new.unit.range.start_line >= self.to_line
            && new.unit.range.end_line < self.to_line + self.to_line_count
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pair(path: &str, old: &str, new: &str) -> FilePair {
        FilePair {
            path: RelativePath::parse(path).unwrap(),
            status: FileStatus::Modified,
            old_text: old.to_owned(),
            new_text: new.to_owned(),
        }
    }
    #[test]
    fn reports_a_typescript_rename() {
        let result = analyze_file(&pair(
            "src/a.ts",
            "export const before = 1;",
            "export const after = 1;",
        ));
        assert!(
            matches!(result, SemanticResult::Parsed { changes, .. } if matches!(changes.first(), Some(SemanticChange::Renamed { .. })))
        );
    }
    #[test]
    fn detects_a_cross_file_move() {
        let files = [
            pair("src/a.rs", "fn moved() {}", ""),
            pair("src/b.rs", "", "fn moved() {}"),
        ];
        let moves = analyze_review(&files);
        assert_eq!(moves.len(), 1);
        assert_eq!(moves[0].to_path.as_str(), "src/b.rs");
        assert_eq!(moves[0].matched, MoveMatch::Exact);
    }

    #[test]
    fn reports_semantic_changes_in_a_deterministic_order() {
        let old = "fn a() { 1 }\nfn b() { 2 }\nfn c() { 3 }\nfn d() { 4 }\n";
        let new = "fn a() { 10 }\nfn b() { 20 }\nfn c() { 30 }\nfn d() { 40 }\n";
        let labels = |result: SemanticResult| match result {
            SemanticResult::Parsed { changes, .. } => changes
                .into_iter()
                .map(|change| match change {
                    SemanticChange::Updated { label, .. } => label,
                    other => panic!("expected an update, got {other:?}"),
                })
                .collect::<Vec<_>>(),
            other => panic!("expected a parsed result, got {other:?}"),
        };
        assert_eq!(
            labels(analyze_file(&pair("src/lib.rs", old, new))),
            vec!["a", "b", "c", "d"]
        );
    }

    #[test]
    fn parses_python_and_opentofu_with_native_grammars() {
        for (path, old, new) in [
            (
                "service.py",
                "def before(value):\n    return value\n",
                "def after(value):\n    return value\n",
            ),
            (
                "main.tf",
                "resource \"aws_s3_bucket\" \"before\" {}\n",
                "resource \"aws_s3_bucket\" \"after\" {}\n",
            ),
        ] {
            assert!(matches!(
                analyze_file(&pair(path, old, new)),
                SemanticResult::Parsed { .. }
            ));
        }
    }
}
