import pythonRegistration from "@ast-grep/lang-python";
import rustRegistration from "@ast-grep/lang-rust";
import {
  Lang,
  parse,
  registerDynamicLanguage,
  type SgNode,
} from "@ast-grep/napi";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

import type { SourceRange } from "../src/domain";

export type SupportedLanguage = Readonly<{
  ast: Parameters<typeof parse>[0];
  name:
    | "JavaScript"
    | "OpenTofu / HCL"
    | "Python"
    | "Rust"
    | "TypeScript"
    | "TSX";
}>;

const HCL_LANGUAGE = "hcl";
const PYTHON_LANGUAGE = "python";
const RUST_LANGUAGE = "rust";

const require = createRequire(import.meta.url);
const hclPackageRoot = resolve(
  dirname(require.resolve("@tree-sitter-grammars/tree-sitter-hcl")),
  "../..",
);
// ast-grep needs a shared-library path. The grammar's Node prebuild also exports
// tree_sitter_hcl, so one cross-platform binary can serve both APIs.
const hclRegistration = {
  libraryPath: join(
    hclPackageRoot,
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "@tree-sitter-grammars+tree-sitter-hcl.node",
  ),
  extensions: ["hcl", "tf", "tfvars", "tofu"],
  languageSymbol: "tree_sitter_hcl",
};

registerDynamicLanguage({
  [HCL_LANGUAGE]: hclRegistration,
  [PYTHON_LANGUAGE]: pythonRegistration,
  [RUST_LANGUAGE]: rustRegistration,
});

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

export const languageForPath = (
  path: string,
): SupportedLanguage | undefined => {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (extension === "ts") return { ast: Lang.TypeScript, name: "TypeScript" };
  if (extension === "tsx") return { ast: Lang.Tsx, name: "TSX" };
  if (extension === "py" || extension === "pyi") {
    return { ast: PYTHON_LANGUAGE, name: "Python" };
  }
  if (extension === "rs") return { ast: RUST_LANGUAGE, name: "Rust" };
  if (
    extension === "hcl" ||
    extension === "tf" ||
    extension === "tfvars" ||
    extension === "tofu"
  ) {
    return { ast: HCL_LANGUAGE, name: "OpenTofu / HCL" };
  }
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
  "class_definition",
  "decorated_definition",
  "enum_declaration",
  "function_declaration",
  "function_definition",
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
  "assignment",
  "attribute",
  "block",
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
  "function_definition",
  "type_item",
  "attribute",
  "block",
]);

const containerKinds = new Set([
  "class_declaration",
  "class_definition",
  "impl_item",
  "interface_declaration",
  "mod_item",
  "trait_item",
  "block",
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
  /(?:bool|boolean|char|float|integer|number|numeric|string|template|regex|true|false|null|undefined)/;

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
  return children.flatMap((child) => leafTokens(child, shape));
};

const nodeLabel = (node: SgNode): string => {
  if (String(node.kind()) === "block") {
    const labels = node
      .children()
      .filter((child) =>
        ["identifier", "string_lit"].includes(String(child.kind())),
      )
      .map((child) => child.text().replace(/^"|"$/g, ""));
    const [blockType, ...blockLabels] = labels;
    if (blockType !== undefined) {
      return blockLabels.length === 0
        ? blockType
        : `${blockType} ${blockLabels.join(".")}`;
    }
  }
  if (String(node.kind()) === "decorated_definition") {
    const definition = node
      .children()
      .find((child) =>
        ["class_definition", "function_definition"].includes(
          String(child.kind()),
        ),
      );
    if (definition !== undefined) return nodeLabel(definition);
  }
  const queue = [...node.children()];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (identifierKinds.has(String(current.kind()))) return current.text();
    queue.push(...current.children());
  }
  return String(node.kind()).replaceAll("_", " ");
};

const nodePreview = (node: SgNode) => {
  const previewNode =
    String(node.kind()) === "decorated_definition"
      ? (node
          .children()
          .find((child) =>
            ["class_definition", "function_definition"].includes(
              String(child.kind()),
            ),
          ) ?? node)
      : node;
  return (
    previewNode
      .text()
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim()
      .slice(0, 100) ?? ""
  );
};

const collectUnits = (
  root: SgNode,
  includeMembers: boolean,
): ReadonlyArray<AstUnit> => {
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

export const uniqueBy = <T>(
  items: ReadonlyArray<T>,
  key: (item: T) => string,
) => {
  const grouped = new Map<string, Array<T>>();
  for (const item of items) {
    const value = key(item);
    grouped.set(value, [...(grouped.get(value) ?? []), item]);
  }
  return new Map(
    [...grouped].flatMap(([value, matches]) =>
      matches.length === 1 && matches[0] !== undefined
        ? [[value, matches[0]] as const]
        : [],
    ),
  );
};
