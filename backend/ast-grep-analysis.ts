import rustRegistration from "@ast-grep/lang-rust";
import {
  Lang,
  parse,
  registerDynamicLanguage,
  type SgNode,
} from "@ast-grep/napi";

import type { SourceRange } from "../src/domain";

export type SupportedLanguage = Readonly<{
  ast: Parameters<typeof parse>[0];
  name: "JavaScript" | "Rust" | "TypeScript" | "TSX";
}>;

const RUST_LANGUAGE = "rust";

registerDynamicLanguage({ [RUST_LANGUAGE]: rustRegistration });

export type AstUnit = Readonly<{
  kind: string;
  label: string;
  range: SourceRange;
  exactFingerprint: string;
  shapeFingerprint: string;
  preview: string;
  text: string;
  order: number;
}>;

export const languageForPath = (path: string): SupportedLanguage | undefined => {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (extension === "ts") return { ast: Lang.TypeScript, name: "TypeScript" };
  if (extension === "tsx") return { ast: Lang.Tsx, name: "TSX" };
  if (extension === "rs") return { ast: RUST_LANGUAGE, name: "Rust" };
  if (
    extension === "js" ||
    extension === "jsx" ||
    extension === "mjs" ||
    extension === "cjs"
  ) {
    return { ast: Lang.JavaScript, name: "JavaScript" };
  }
  return undefined;
};

const declarationKinds = new Set([
  "class_declaration",
  "enum_declaration",
  "function_declaration",
  "interface_declaration",
  "lexical_declaration",
  "type_alias_declaration",
  "variable_declaration",
  "const_item",
  "enum_item",
  "foreign_mod_item",
  "function_item",
  "function_signature_item",
  "impl_item",
  "macro_definition",
  "mod_item",
  "static_item",
  "struct_item",
  "trait_item",
  "type_item",
  "union_item",
]);

const memberKinds = new Set([
  "abstract_method_signature",
  "method_definition",
  "method_signature",
  "public_field_definition",
  "associated_type",
  "const_item",
  "function_item",
  "function_signature_item",
  "type_item",
]);

const containerKinds = new Set([
  "class_declaration",
  "impl_item",
  "interface_declaration",
  "mod_item",
  "trait_item",
]);

const identifierKinds = new Set([
  "identifier",
  "private_property_identifier",
  "property_identifier",
  "shorthand_property_identifier",
  "type_identifier",
  "field_identifier",
]);

const literalKind =
  /(?:boolean|char|float|integer|number|string|template|regex|true|false|null|undefined)/;

const toSourceRange = (node: SgNode): SourceRange => {
  const range = node.range();
  return {
    startLine: range.start.line + 1,
    endLine: range.end.line + 1,
    startColumn: range.start.column + 1,
    endColumn: range.end.column + 1,
  };
};

const leafTokens = (node: SgNode, shape: boolean): ReadonlyArray<string> => {
  if (String(node.kind()).includes("comment")) return [];
  const children = node.children();
  if (children.length === 0) {
    const kind = String(node.kind());
    const text = shape
      ? identifierKinds.has(kind)
        ? "$identifier"
        : literalKind.test(kind)
          ? "$literal"
          : node.text()
      : node.text();
    return [`${kind}:${text}`];
  }
  return children.flatMap(child => leafTokens(child, shape));
};

const nodeLabel = (node: SgNode) => {
  const queue = [...node.children()];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (identifierKinds.has(String(current.kind()))) return current.text();
    queue.push(...current.children());
  }
  return String(node.kind()).replaceAll("_", " ");
};

const nodePreview = (node: SgNode) =>
  node.text().split("\n").find(line => line.trim() !== "")?.trim().slice(0, 100) ?? "";

const collectUnits = (root: SgNode, includeMembers: boolean): ReadonlyArray<AstUnit> => {
  const units: Array<AstUnit> = [];
  const visit = (node: SgNode, insideContainer: boolean) => {
    const kind = String(node.kind());
    const declaration = declarationKinds.has(kind);
    const member = includeMembers && insideContainer && memberKinds.has(kind);
    if (declaration || member) {
      const tokens = leafTokens(node, false);
      units.push({
        kind,
        label: nodeLabel(node),
        range: toSourceRange(node),
        exactFingerprint: `${kind}|${tokens.join("|")}`,
        shapeFingerprint: `${kind}|${leafTokens(node, true).join("|")}`,
        preview: nodePreview(node),
        text: node.text(),
        order: units.length,
      });
      if (!containerKinds.has(kind) || !includeMembers) return;
    }
    for (const child of node.children()) {
      visit(child, insideContainer || containerKinds.has(kind));
    }
  };
  visit(root, false);
  return units;
};

const hasParseError = (node: SgNode): boolean =>
  String(node.kind()) === "ERROR" || node.children().some(hasParseError);

export const parseUnits = (
  language: SupportedLanguage,
  source: string,
  includeMembers: boolean,
) => {
  const root = parse(language.ast, source).root();
  return {
    parseFailed: hasParseError(root),
    fingerprint: leafTokens(root, false).join("|"),
    units: collectUnits(root, includeMembers),
  };
};

export const uniqueBy = <T>(items: ReadonlyArray<T>, key: (item: T) => string) => {
  const grouped = new Map<string, Array<T>>();
  for (const item of items) {
    const value = key(item);
    grouped.set(value, [...(grouped.get(value) ?? []), item]);
  }
  return new Map(
    [...grouped].flatMap(([value, matches]) =>
      matches.length === 1 && matches[0] !== undefined ? [[value, matches[0]] as const] : [],
    ),
  );
};
