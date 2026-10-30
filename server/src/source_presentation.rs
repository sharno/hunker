use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    sync::LazyLock,
};

use ast_grep_core::tree_sitter::LanguageExt;
use serde::Serialize;
use tree_sitter::{Query, QueryCursor, StreamingIterator, Tree};

use crate::language::{LANGUAGES, Language, LanguageSpec};

const HCL_HIGHLIGHTS_QUERY: &str = r#"
(comment) @comment
(string_lit) @string
(numeric_lit) @number
(bool_lit) @constant.builtin
(identifier) @variable
[
  "for"
  "in"
  "if"
] @keyword
(attribute (identifier) @property)
(block (identifier) @type)
"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HighlightKind {
    Attribute,
    Comment,
    Constant,
    Function,
    Keyword,
    Module,
    Number,
    Operator,
    Property,
    Punctuation,
    String,
    Tag,
    Type,
    Variable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightSpan {
    pub line: usize,
    pub start_character: usize,
    pub end_character: usize,
    pub kind: HighlightKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FoldKind {
    Block,
    Class,
    Function,
    Implementation,
    Interface,
    Module,
    Trait,
    Type,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoldRegion {
    pub id: String,
    pub kind: FoldKind,
    pub label: String,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePresentation {
    pub language: String,
    pub highlights: Vec<HighlightSpan>,
    pub folds: Vec<FoldRegion>,
}

impl SourcePresentation {
    pub fn restrict_to_lines(&self, lines: &BTreeSet<usize>) -> Self {
        Self {
            language: self.language.clone(),
            highlights: self
                .highlights
                .iter()
                .filter(|span| lines.contains(&span.line))
                .cloned()
                .collect(),
            folds: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "_tag")]
pub enum SourcePresentationResult {
    Unsupported { reason: String },
    Complete { value: SourcePresentation },
}

impl SourcePresentationResult {
    pub fn restrict_to_lines(&self, lines: &BTreeSet<usize>) -> Self {
        match self {
            Self::Unsupported { reason } => Self::Unsupported {
                reason: reason.clone(),
            },
            Self::Complete { value } => Self::Complete {
                value: value.restrict_to_lines(lines),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePresentation {
    pub old: SourcePresentationResult,
    pub new: SourcePresentationResult,
}

impl FilePresentation {
    pub fn restrict_to_lines(
        &self,
        old_lines: &BTreeSet<usize>,
        new_lines: &BTreeSet<usize>,
    ) -> Self {
        Self {
            old: self.old.restrict_to_lines(old_lines),
            new: self.new.restrict_to_lines(new_lines),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct FoldSeed {
    pub kind: String,
    pub label: String,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone, Copy)]
struct RawSpan {
    start: usize,
    end: usize,
    kind: HighlightKind,
    priority: usize,
}

pub(crate) fn unsupported() -> SourcePresentationResult {
    SourcePresentationResult::Unsupported {
        reason: "Syntax highlighting is unavailable for this language.".to_owned(),
    }
}

/// Highlight queries compile once per language; compiling per file side
/// dominated presentation time.
static QUERIES: LazyLock<HashMap<Language, Result<Query, String>>> = LazyLock::new(|| {
    LANGUAGES
        .iter()
        .map(|spec| {
            let query = Query::new(
                &spec.grammar.get_ts_language(),
                highlight_query(spec.language),
            )
            .map_err(|error| error.to_string());
            (spec.language, query)
        })
        .collect()
});

pub(crate) fn build(
    language: &LanguageSpec,
    source: &str,
    tree: &Tree,
    fold_seeds: impl IntoIterator<Item = FoldSeed>,
) -> SourcePresentationResult {
    let query = match QUERIES.get(&language.language) {
        Some(Ok(query)) => query,
        Some(Err(error)) => {
            return SourcePresentationResult::Unsupported {
                reason: format!("The bundled syntax query could not be prepared: {error}"),
            };
        }
        None => return unsupported(),
    };
    SourcePresentationResult::Complete {
        value: SourcePresentation {
            language: language.name.to_owned(),
            highlights: highlights(query, source, tree),
            folds: fold_seeds.into_iter().filter_map(fold_region).collect(),
        },
    }
}

fn highlight_query(language: Language) -> &'static str {
    match language {
        Language::JavaScript => tree_sitter_javascript::HIGHLIGHT_QUERY,
        Language::TypeScript | Language::Tsx => tree_sitter_typescript::HIGHLIGHTS_QUERY,
        Language::Python => tree_sitter_python::HIGHLIGHTS_QUERY,
        Language::Rust => tree_sitter_rust::HIGHLIGHTS_QUERY,
        Language::Hcl => HCL_HIGHLIGHTS_QUERY,
    }
}

fn highlights(query: &Query, source: &str, tree: &Tree) -> Vec<HighlightSpan> {
    let line_starts = line_starts(source);
    let capture_names = query.capture_names();
    let mut by_line = BTreeMap::<usize, Vec<RawSpan>>::new();
    let mut cursor = QueryCursor::new();
    let mut captures = cursor.captures(query, tree.root_node(), source.as_bytes());
    while let Some((matched, capture_index)) = captures.next() {
        let capture = matched.captures[*capture_index];
        let Some(kind) = capture_names
            .get(capture.index as usize)
            .and_then(|name| highlight_kind(name))
        else {
            continue;
        };
        let node = capture.node;
        for row in node.start_position().row..=node.end_position().row {
            let Some(line_start) = line_starts.get(row).copied() else {
                continue;
            };
            let line_end = line_starts
                .get(row + 1)
                .copied()
                .map_or(source.len(), |next| next.saturating_sub(1));
            let start_byte = node.start_byte().max(line_start).min(line_end);
            let end_byte = node.end_byte().max(start_byte).min(line_end);
            if start_byte == end_byte {
                continue;
            }
            let start = source[line_start..start_byte].chars().count();
            let end = source[line_start..end_byte].chars().count();
            by_line.entry(row + 1).or_default().push(RawSpan {
                start,
                end,
                kind,
                priority: matched.pattern_index,
            });
        }
    }
    by_line
        .into_iter()
        .flat_map(|(line, spans)| normalize_line(line, &spans))
        .collect()
}

fn normalize_line(line: usize, spans: &[RawSpan]) -> Vec<HighlightSpan> {
    let boundaries = spans
        .iter()
        .flat_map(|span| [span.start, span.end])
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let mut normalized: Vec<HighlightSpan> = Vec::new();
    for window in boundaries.windows(2) {
        let [start, end] = [window[0], window[1]];
        let selected = spans
            .iter()
            .filter(|span| span.start <= start && span.end >= end)
            .max_by_key(|span| (span.priority, usize::MAX - (span.end - span.start)));
        let Some(selected) = selected else {
            continue;
        };
        if let Some(previous) = normalized.last_mut()
            && previous.end_character == start
            && previous.kind == selected.kind
        {
            previous.end_character = end;
        } else {
            normalized.push(HighlightSpan {
                line,
                start_character: start,
                end_character: end,
                kind: selected.kind,
            });
        }
    }
    normalized
}

fn line_starts(source: &str) -> Vec<usize> {
    std::iter::once(0)
        .chain(
            source
                .bytes()
                .enumerate()
                .filter_map(|(index, byte)| (byte == b'\n').then_some(index + 1)),
        )
        .collect()
}

fn highlight_kind(capture: &str) -> Option<HighlightKind> {
    match capture.split('.').next()? {
        "attribute" => Some(HighlightKind::Attribute),
        "comment" => Some(HighlightKind::Comment),
        "constant" | "constructor" => Some(HighlightKind::Constant),
        "function" | "method" => Some(HighlightKind::Function),
        "keyword" => Some(HighlightKind::Keyword),
        "module" | "namespace" => Some(HighlightKind::Module),
        "number" | "float" => Some(HighlightKind::Number),
        "operator" => Some(HighlightKind::Operator),
        "property" | "field" => Some(HighlightKind::Property),
        "punctuation" => Some(HighlightKind::Punctuation),
        "string" | "character" => Some(HighlightKind::String),
        "tag" => Some(HighlightKind::Tag),
        "type" => Some(HighlightKind::Type),
        "variable" => Some(HighlightKind::Variable),
        _ => None,
    }
}

fn fold_region(seed: FoldSeed) -> Option<FoldRegion> {
    if seed.end_line <= seed.start_line {
        return None;
    }
    let kind = match seed.kind.as_str() {
        "function_declaration" | "function_definition" | "function_item" | "method_definition" => {
            FoldKind::Function
        }
        "class_declaration" | "class_definition" => FoldKind::Class,
        "interface_declaration" => FoldKind::Interface,
        "impl_item" => FoldKind::Implementation,
        "mod_item" => FoldKind::Module,
        "trait_item" => FoldKind::Trait,
        "enum_declaration" | "enum_item" | "struct_item" | "union_item" => FoldKind::Type,
        "block" => FoldKind::Block,
        _ => return None,
    };
    Some(FoldRegion {
        id: format!(
            "{}:{}:{}:{}",
            seed.kind, seed.start_line, seed.end_line, seed.label
        ),
        kind,
        label: seed.label,
        start_line: seed.start_line,
        end_line: seed.end_line,
    })
}

#[cfg(test)]
mod tests {
    use ast_grep_core::tree_sitter::StrDoc;
    use ast_grep_language::SupportLang;

    use super::*;

    fn spec(language: Language) -> &'static LanguageSpec {
        LANGUAGES
            .iter()
            .find(|spec| spec.language == language)
            .unwrap()
    }

    #[test]
    fn every_bundled_highlight_query_compiles() {
        assert!(QUERIES.values().all(Result::is_ok));
    }

    #[test]
    fn highlights_unicode_with_character_offsets_and_builds_folds() {
        let source = "fn café(value: &str) {\n    println!(\"{value}\");\n}\n";
        let document = StrDoc::new(source, SupportLang::Rust);
        let result = build(
            spec(Language::Rust),
            source,
            &document.tree,
            [FoldSeed {
                kind: "function_item".to_owned(),
                label: "café".to_owned(),
                start_line: 1,
                end_line: 3,
            }],
        );
        let SourcePresentationResult::Complete { value } = result else {
            panic!("Rust presentation should be available");
        };
        assert!(value.highlights.iter().any(|span| {
            span.line == 1 && span.kind == HighlightKind::Function && span.end_character <= 22
        }));
        assert_eq!(value.folds.len(), 1);
        assert_eq!(value.folds[0].start_line, 1);
        assert_eq!(value.folds[0].end_line, 3);
    }

    #[test]
    fn prepares_hcl_with_the_bundled_query() {
        let source = "resource \"aws_s3_bucket\" \"logs\" {\n  force_destroy = true\n}\n";
        let document = StrDoc::new(source, SupportLang::Hcl);
        let result = build(
            spec(Language::Hcl),
            source,
            &document.tree,
            std::iter::empty(),
        );
        let SourcePresentationResult::Complete { value } = result else {
            panic!("HCL presentation should be available: {result:?}");
        };
        assert!(
            value
                .highlights
                .iter()
                .any(|span| span.kind == HighlightKind::Type)
        );
        assert!(
            value
                .highlights
                .iter()
                .any(|span| span.kind == HighlightKind::Property)
        );
    }
}
