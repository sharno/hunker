import type { Element, RootContent } from "hast";
import type { LanguageFn } from "highlight.js";
import { Array as EffectArray } from "effect";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import type { Html, HtmlBuilder } from "foldkit/html";
import { createLowlight } from "lowlight";

import type { CharacterRange, Message } from "../domain";

type SyntaxToken = Readonly<{
  text: string;
  classes: ReadonlyArray<string>;
}>;

const hcl: LanguageFn = (hljs) => ({
  name: "OpenTofu/HCL",
  aliases: ["hcl", "terraform", "tf"],
  keywords: {
    keyword: "for in if else dynamic iterator content",
    literal: "true false null",
  },
  contains: [
    hljs.HASH_COMMENT_MODE,
    hljs.C_LINE_COMMENT_MODE,
    hljs.C_BLOCK_COMMENT_MODE,
    hljs.QUOTE_STRING_MODE,
    hljs.NUMBER_MODE,
    {
      className: "type",
      begin:
        /\b(?:resource|data|module|variable|output|locals|terraform|provider|moved|import|check)\b/,
    },
    {
      className: "subst",
      begin: /\$\{/,
      end: /\}/,
      keywords: "for in if else",
    },
  ],
});

const lowlight = createLowlight({
  bash,
  c,
  cpp,
  css,
  go,
  hcl,
  java,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
});

const extensionLanguages: Readonly<Record<string, string>> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  css: "css",
  cts: "typescript",
  go: "go",
  h: "c",
  hcl: "hcl",
  hpp: "cpp",
  html: "xml",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "json",
  jsx: "javascript",
  md: "markdown",
  mjs: "javascript",
  mts: "typescript",
  py: "python",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  tf: "hcl",
  tfvars: "hcl",
  ts: "typescript",
  tsx: "typescript",
  xhtml: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

const languageForPath = (path: string) => {
  const fileName = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (fileName === "dockerfile") return "bash";
  const extension = fileName.split(".").at(-1) ?? "";
  return extensionLanguages[extension];
};

const classNames = (element: Element): ReadonlyArray<string> => {
  const value = element.properties.className;
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
};

const flattenNode = (
  node: RootContent,
  inherited: ReadonlyArray<string>,
): ReadonlyArray<SyntaxToken> => {
  if (node.type === "text") return [{ text: node.value, classes: inherited }];
  if (node.type !== "element") return [];
  const classes = [...inherited, ...classNames(node)];
  return node.children.flatMap((child) => flattenNode(child, classes));
};

const tokenCache = new Map<string, ReadonlyArray<SyntaxToken>>();
const maximumCachedLines = 10_000;

const highlightedTokens = (language: string, source: string) => {
  const key = `${language}\u0000${source}`;
  const cached = tokenCache.get(key);
  if (cached !== undefined) return cached;
  const tree = lowlight.highlight(language, source);
  const tokens = tree.children.flatMap((node) => flattenNode(node, []));
  if (tokenCache.size >= maximumCachedLines) tokenCache.clear();
  tokenCache.set(key, tokens);
  return tokens;
};

const tokenPiece = (
  text: string,
  classes: ReadonlyArray<string>,
  changed: boolean,
  h: HtmlBuilder<Message>,
): string | Html => {
  const className = [...classes, ...(changed ? ["char-change"] : [])].join(" ");
  return className === "" ? text : h.span([h.Class(className)], [text]);
};

const renderToken = (
  token: SyntaxToken,
  offset: number,
  changed: ReadonlyArray<CharacterRange>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<string | Html> => {
  const tokenEnd = offset + token.text.length;
  const boundaries = changed.flatMap((range) => {
    const overlapStart = Math.max(offset, range.start);
    const overlapEnd = Math.min(tokenEnd, range.end);
    return overlapStart < overlapEnd
      ? [overlapStart - offset, overlapEnd - offset]
      : [];
  });
  return EffectArray.match(boundaries, {
    onEmpty: () => [tokenPiece(token.text, token.classes, false, h)],
    onNonEmpty: () => {
      const points = [
        ...new Set([0, ...boundaries, token.text.length]),
      ].toSorted((left, right) => left - right);
      return points.slice(0, -1).flatMap((start, index) => {
        const end = points[index + 1];
        if (end === undefined || start === end) return [];
        const absoluteStart = offset + start;
        const absoluteEnd = offset + end;
        const isChanged = changed.some(
          (range) => absoluteStart < range.end && absoluteEnd > range.start,
        );
        return [
          tokenPiece(token.text.slice(start, end), token.classes, isChanged, h),
        ];
      });
    },
  });
};

// NOTE: Offset is a function-local cursor across immutable tokens; it avoids
// repeatedly summing prefixes while preserving a pure render result.
export const syntaxHighlightedContent = (
  path: string,
  source: string,
  enabled: boolean,
  changed: ReadonlyArray<CharacterRange>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<string | Html> => {
  const visibleSource = source || " ";
  const language = enabled ? languageForPath(path) : undefined;
  const tokens =
    language === undefined
      ? [{ text: visibleSource, classes: [] }]
      : highlightedTokens(language, visibleSource);
  let offset = 0;
  return tokens.flatMap((token) => {
    const rendered = renderToken(token, offset, changed, h);
    offset += token.text.length;
    return rendered;
  });
};
