use ast_grep_language::SupportLang;

/// A language Hunker can parse with a bundled Tree-sitter grammar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Language {
    TypeScript,
    Tsx,
    JavaScript,
    Python,
    Rust,
    Hcl,
}

#[derive(Debug)]
pub struct LanguageSpec {
    pub language: Language,
    pub grammar: SupportLang,
    pub name: &'static str,
    extensions: &'static [&'static str],
}

pub const LANGUAGES: [LanguageSpec; 6] = [
    LanguageSpec {
        language: Language::TypeScript,
        grammar: SupportLang::TypeScript,
        name: "TypeScript",
        extensions: &["ts", "mts", "cts"],
    },
    LanguageSpec {
        language: Language::Tsx,
        grammar: SupportLang::Tsx,
        name: "TSX",
        extensions: &["tsx"],
    },
    LanguageSpec {
        language: Language::JavaScript,
        grammar: SupportLang::JavaScript,
        name: "JavaScript",
        extensions: &["js", "jsx", "mjs", "cjs"],
    },
    LanguageSpec {
        language: Language::Python,
        grammar: SupportLang::Python,
        name: "Python",
        extensions: &["py", "pyi"],
    },
    LanguageSpec {
        language: Language::Rust,
        grammar: SupportLang::Rust,
        name: "Rust",
        extensions: &["rs"],
    },
    LanguageSpec {
        language: Language::Hcl,
        grammar: SupportLang::Hcl,
        name: "OpenTofu / HCL",
        extensions: &["hcl", "tf", "tfvars", "tofu"],
    },
];

impl LanguageSpec {
    pub fn for_path(path: &str) -> Option<&'static Self> {
        let (_, extension) = path.rsplit_once('.')?;
        let extension = extension.to_ascii_lowercase();
        LANGUAGES
            .iter()
            .find(|spec| spec.extensions.contains(&extension.as_str()))
    }
}

/// "JavaScript, TypeScript, …" for user-facing messages, derived from the table.
pub fn supported_names() -> String {
    LANGUAGES
        .iter()
        .map(|spec| spec.name)
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_languages_from_the_extension_table() {
        assert_eq!(
            LanguageSpec::for_path("infra/main.TF").map(|spec| spec.language),
            Some(Language::Hcl)
        );
        assert_eq!(
            LanguageSpec::for_path("src/app.tsx").map(|spec| spec.language),
            Some(Language::Tsx)
        );
        assert!(LanguageSpec::for_path("README").is_none());
        assert!(LanguageSpec::for_path("notes.md").is_none());
    }
}
