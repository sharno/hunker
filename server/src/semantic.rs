use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::OnceLock,
};

use ast_grep_core::tree_sitter::{LanguageExt, StrDoc};
use ast_grep_core::{Doc, Node};
use ast_grep_language::SupportLang;
use regex::Regex;
use serde::Serialize;

use crate::types::{FilePair, FileStatus, SourceRange};

#[derive(Debug, Clone, Copy)]
struct SupportedLanguage {
    language: SupportLang,
    name: &'static str,
}

fn language_for_path(path: &str) -> Option<SupportedLanguage> {
    let extension = path.rsplit('.').next()?.to_ascii_lowercase();
    match extension.as_str() {
        "ts" => Some(SupportedLanguage {
            language: SupportLang::TypeScript,
            name: "TypeScript",
        }),
        "tsx" => Some(SupportedLanguage {
            language: SupportLang::Tsx,
            name: "TSX",
        }),
        "js" | "jsx" | "mjs" | "cjs" => Some(SupportedLanguage {
            language: SupportLang::JavaScript,
            name: "JavaScript",
        }),
        "py" | "pyi" => Some(SupportedLanguage {
            language: SupportLang::Python,
            name: "Python",
        }),
        "rs" => Some(SupportedLanguage {
            language: SupportLang::Rust,
            name: "Rust",
        }),
        "hcl" | "tf" | "tfvars" | "tofu" => Some(SupportedLanguage {
            language: SupportLang::Hcl,
            name: "OpenTofu / HCL",
        }),
        _ => None,
    }
}

#[derive(Debug, Clone)]
struct AstUnit {
    kind: String,
    label: String,
    range: SourceRange,
    exact_fingerprint: String,
    label_fingerprint: String,
    shape_fingerprint: String,
    preview: String,
    text: String,
    order: usize,
}

struct Parsed {
    parse_failed: bool,
    fingerprint: String,
    units: Vec<AstUnit>,
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

fn collect_units(root: &SgNode<'_>, include_members: bool) -> Vec<AstUnit> {
    fn visit(
        node: &SgNode<'_>,
        inside_container: bool,
        include_members: bool,
        units: &mut Vec<AstUnit>,
    ) {
        let kind = node.kind().into_owned();
        if declaration(&kind) || (include_members && inside_container && member(&kind)) {
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
                text: node.text().into_owned(),
                order: units.len(),
            });
            if !container(&kind) || !include_members {
                return;
            }
        }
        for child in node.children() {
            visit(
                &child,
                inside_container || container(&kind),
                include_members,
                units,
            );
        }
    }
    let mut units = Vec::new();
    visit(root, false, include_members, &mut units);
    units
}

fn parse_units(language: SupportedLanguage, source: &str, include_members: bool) -> Parsed {
    let grep = language.language.ast_grep(source);
    let root = grep.root();
    let parse_failed = root
        .dfs()
        .any(|node| node.is_error() || node.kind() == "ERROR");
    let mut fingerprint = Vec::new();
    leaf_tokens(&root, false, &mut fingerprint);
    Parsed {
        parse_failed,
        fingerprint: fingerprint.join("|"),
        units: collect_units(&root, include_members),
    }
}

fn unique_by<F>(units: &[AstUnit], remaining: &[bool], key: F) -> HashMap<String, usize>
where
    F: Fn(&AstUnit) -> &str,
{
    let mut grouped: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, unit) in units
        .iter()
        .enumerate()
        .filter(|(index, _)| remaining[*index])
    {
        grouped.entry(key(unit).to_owned()).or_default().push(index);
    }
    grouped
        .into_iter()
        .filter_map(|(key, values)| (values.len() == 1).then_some((key, values[0])))
        .collect()
}

pub fn analyze_file(file: &FilePair) -> SemanticResult {
    let Some(language) = language_for_path(&file.path) else {
        return SemanticResult::Unsupported { path: file.path.clone(), reason: "ast-grep semantic analysis currently supports JavaScript, TypeScript, Python, Rust, and OpenTofu/HCL.".to_owned() };
    };
    let before = parse_units(language, &file.old_text, false);
    let after = parse_units(language, &file.new_text, false);
    if before.parse_failed || after.parse_failed {
        return SemanticResult::ParseFailed {
            path: file.path.clone(),
            language: language.name.to_owned(),
            reason: "ast-grep found an incomplete syntax tree, so the regular patch is shown."
                .to_owned(),
        };
    }
    let mut old_remaining = vec![true; before.units.len()];
    let mut new_remaining = vec![true; after.units.len()];
    let mut changes = Vec::new();
    consume(
        &before.units,
        &after.units,
        &mut old_remaining,
        &mut new_remaining,
        |unit| &unit.exact_fingerprint,
        |_, _| None,
        &mut changes,
    );
    consume(
        &before.units,
        &after.units,
        &mut old_remaining,
        &mut new_remaining,
        |unit| &unit.label_fingerprint,
        |old, new| {
            Some(SemanticChange::Updated {
                kind: old.kind.clone(),
                label: old.label.clone(),
                old_range: old.range.clone(),
                new_range: new.range.clone(),
                confidence: 1.0,
            })
        },
        &mut changes,
    );
    consume(
        &before.units,
        &after.units,
        &mut old_remaining,
        &mut new_remaining,
        |unit| &unit.shape_fingerprint,
        |old, new| {
            Some(SemanticChange::Renamed {
                kind: old.kind.clone(),
                old_label: old.label.clone(),
                new_label: new.label.clone(),
                old_range: old.range.clone(),
                new_range: new.range.clone(),
                confidence: 0.85,
            })
        },
        &mut changes,
    );
    changes.extend(
        before
            .units
            .iter()
            .enumerate()
            .filter(|(index, _)| old_remaining[*index])
            .map(|(_, unit)| SemanticChange::Deleted {
                kind: unit.kind.clone(),
                label: unit.label.clone(),
                old_range: unit.range.clone(),
                confidence: 1.0,
            }),
    );
    changes.extend(
        after
            .units
            .iter()
            .enumerate()
            .filter(|(index, _)| new_remaining[*index])
            .map(|(_, unit)| SemanticChange::Inserted {
                kind: unit.kind.clone(),
                label: unit.label.clone(),
                new_range: unit.range.clone(),
                confidence: 1.0,
            }),
    );
    SemanticResult::Parsed {
        path: file.path.clone(),
        language: language.name.to_owned(),
        semantic_equal: before.fingerprint == after.fingerprint,
        changes,
    }
}

fn consume<F, G>(
    old: &[AstUnit],
    new: &[AstUnit],
    old_remaining: &mut [bool],
    new_remaining: &mut [bool],
    key: F,
    make: G,
    changes: &mut Vec<SemanticChange>,
) where
    F: Fn(&AstUnit) -> &str + Copy,
    G: Fn(&AstUnit, &AstUnit) -> Option<SemanticChange>,
{
    let old_unique = unique_by(old, old_remaining, key);
    let new_unique = unique_by(new, new_remaining, key);
    for (value, old_index) in old_unique {
        let Some(new_index) = new_unique.get(&value).copied() else {
            continue;
        };
        let old_unit = &old[old_index];
        let new_unit = &new[new_index];
        if let Some(change) = make(old_unit, new_unit) {
            changes.push(change);
        }
        old_remaining[old_index] = false;
        new_remaining[new_index] = false;
    }
}

#[derive(Clone)]
struct LocatedUnit {
    unit: AstUnit,
    path: String,
    pair_index: usize,
}
fn located_units(files: &[FilePair], old: bool) -> Vec<LocatedUnit> {
    files
        .iter()
        .enumerate()
        .filter(|(_, file)| !crate::diff::generated(&file.path))
        .flat_map(|(pair_index, file)| {
            let Some(language) = language_for_path(&file.path) else {
                return Vec::new();
            };
            let source = if old { &file.old_text } else { &file.new_text };
            if source.is_empty() {
                return Vec::new();
            }
            let parsed = parse_units(language, source, true);
            if parsed.parse_failed {
                return Vec::new();
            }
            let path = if old && file.status == FileStatus::Renamed {
                file.previous_path
                    .clone()
                    .unwrap_or_else(|| file.path.clone())
            } else {
                file.path.clone()
            };
            parsed
                .units
                .into_iter()
                .map(|unit| LocatedUnit {
                    unit,
                    path: path.clone(),
                    pair_index,
                })
                .collect()
        })
        .collect()
}

pub fn analyze_review(files: &[FilePair]) -> Vec<MovedBlock> {
    let old = located_units(files, true);
    let new = located_units(files, false);
    let mut old_remaining = vec![true; old.len()];
    let mut new_remaining = vec![true; new.len()];
    let mut moves = Vec::new();
    match_moves(
        &old,
        &new,
        &mut old_remaining,
        &mut new_remaining,
        false,
        &mut moves,
    );
    match_moves(
        &old,
        &new,
        &mut old_remaining,
        &mut new_remaining,
        true,
        &mut moves,
    );
    moves
}

fn match_moves(
    old: &[LocatedUnit],
    new: &[LocatedUnit],
    old_remaining: &mut [bool],
    new_remaining: &mut [bool],
    changed: bool,
    moves: &mut Vec<MovedBlock>,
) {
    let key = |unit: &LocatedUnit| {
        if changed {
            unit.unit.shape_fingerprint.clone()
        } else {
            unit.unit.exact_fingerprint.clone()
        }
    };
    let old_unique = unique_located(old, old_remaining, key);
    let new_unique = unique_located(new, new_remaining, key);
    let mut pairs = old_unique
        .into_iter()
        .filter_map(|(value, old_index)| {
            new_unique
                .get(&value)
                .copied()
                .map(|new_index| (old_index, new_index))
        })
        .collect::<Vec<_>>();
    pairs.sort_by_key(|(old_index, _)| std::cmp::Reverse(old[*old_index].unit.text.len()));
    let mut stable = HashSet::new();
    if !changed {
        let mut by_file: HashMap<usize, Vec<(usize, usize, usize)>> = HashMap::new();
        for (pair_index, (old_index, new_index)) in pairs.iter().copied().enumerate() {
            if old[old_index].pair_index == new[new_index].pair_index {
                by_file.entry(old[old_index].pair_index).or_default().push((
                    pair_index,
                    old[old_index].unit.order,
                    new[new_index].unit.order,
                ));
            }
        }
        for mut file_pairs in by_file.into_values() {
            file_pairs.sort_by_key(|(_, old_order, _)| *old_order);
            for index in longest_increasing(
                &file_pairs
                    .iter()
                    .map(|(_, _, new_order)| *new_order)
                    .collect::<Vec<_>>(),
            ) {
                stable.insert(file_pairs[index].0);
            }
        }
    }
    for (pair_index, (old_index, new_index)) in pairs.into_iter().enumerate() {
        old_remaining[old_index] = false;
        new_remaining[new_index] = false;
        let old_unit = &old[old_index];
        let new_unit = &new[new_index];
        let different_file = old_unit.pair_index != new_unit.pair_index;
        let reordered = !changed && !different_file && !stable.contains(&pair_index);
        if !different_file && !reordered {
            continue;
        }
        if moves
            .iter()
            .any(|movement| contains(movement, old_unit, new_unit))
        {
            continue;
        }
        moves.push(MovedBlock {
            from_path: old_unit.path.clone(),
            to_path: new_unit.path.clone(),
            from_line: old_unit.unit.range.start_line,
            to_line: new_unit.unit.range.start_line,
            from_line_count: old_unit
                .unit
                .range
                .end_line
                .saturating_sub(old_unit.unit.range.start_line)
                + 1,
            to_line_count: new_unit
                .unit
                .range
                .end_line
                .saturating_sub(new_unit.unit.range.start_line)
                + 1,
            preview: old_unit.unit.preview.clone(),
            kind: old_unit.unit.kind.clone(),
            label: if changed {
                format!("{} → {}", old_unit.unit.label, new_unit.unit.label)
            } else {
                old_unit.unit.label.clone()
            },
            confidence: if changed { 0.8 } else { 1.0 },
            changed,
        });
    }
}
fn unique_located<F>(units: &[LocatedUnit], remaining: &[bool], key: F) -> HashMap<String, usize>
where
    F: Fn(&LocatedUnit) -> String,
{
    let mut grouped: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, unit) in units
        .iter()
        .enumerate()
        .filter(|(index, _)| remaining[*index])
    {
        grouped.entry(key(unit)).or_default().push(index);
    }
    grouped
        .into_iter()
        .filter_map(|(key, values)| (values.len() == 1).then_some((key, values[0])))
        .collect()
}
fn contains(movement: &MovedBlock, old: &LocatedUnit, new: &LocatedUnit) -> bool {
    movement.from_path == old.path
        && movement.to_path == new.path
        && old.unit.range.start_line >= movement.from_line
        && old.unit.range.end_line < movement.from_line + movement.from_line_count
        && new.unit.range.start_line >= movement.to_line
        && new.unit.range.end_line < movement.to_line + movement.to_line_count
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
    let mut result = HashSet::new();
    let mut cursor = tails.last().copied();
    while let Some(index) = cursor {
        result.insert(index);
        cursor = previous[index];
    }
    result
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "_tag")]
pub enum SemanticResult {
    Parsed {
        path: String,
        language: String,
        #[serde(rename = "semanticEqual")]
        semantic_equal: bool,
        changes: Vec<SemanticChange>,
    },
    Unsupported {
        path: String,
        reason: String,
    },
    ParseFailed {
        path: String,
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
        confidence: f64,
    },
    Deleted {
        kind: String,
        label: String,
        #[serde(rename = "oldRange")]
        old_range: SourceRange,
        confidence: f64,
    },
    Updated {
        kind: String,
        label: String,
        #[serde(rename = "oldRange")]
        old_range: SourceRange,
        #[serde(rename = "newRange")]
        new_range: SourceRange,
        confidence: f64,
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
        confidence: f64,
    },
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovedBlock {
    pub from_path: String,
    pub to_path: String,
    pub from_line: usize,
    pub to_line: usize,
    pub from_line_count: usize,
    pub to_line_count: usize,
    pub preview: String,
    pub kind: String,
    pub label: String,
    pub confidence: f64,
    pub changed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pair(path: &str, old: &str, new: &str) -> FilePair {
        FilePair {
            path: path.to_owned(),
            previous_path: None,
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
        assert_eq!(moves[0].to_path, "src/b.rs");
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
