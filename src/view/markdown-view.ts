import type { Definition, Nodes, Root, RootContent, TableRow } from "mdast";
import type { Html, HtmlBuilder } from "foldkit/html";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { Array as EffectArray } from "effect";

import type { Message } from "../domain";

type MarkdownChild = Html | string;
type Definitions = ReadonlyMap<string, Definition>;

const markdownCache = new Map<string, Root>();
const maximumCachedComments = 1_000;

const parseMarkdown = (source: string) => {
  const cached = markdownCache.get(source);
  if (cached !== undefined) return cached;
  const tree = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  if (markdownCache.size >= maximumCachedComments) markdownCache.clear();
  markdownCache.set(source, tree);
  return tree;
};

const plainText = (node: Nodes): string => {
  switch (node.type) {
    case "text":
    case "inlineCode":
    case "code":
    case "html":
    case "yaml":
      return node.value;
    case "image":
    case "imageReference":
      return node.alt ?? "";
    case "break":
      return " ";
    case "thematicBreak":
    case "definition":
      return "";
    case "footnoteReference":
      return node.label ?? node.identifier;
    default:
      return node.children.map(plainText).join("");
  }
};

export const markdownSummary = (source: string) => {
  const first = parseMarkdown(source).children[0];
  if (first === undefined) return "";
  const summary = plainText(first).trim();
  return summary.length > 120 ? `${summary.slice(0, 117)}…` : summary;
};

const safeHref = (value: string): string | undefined => {
  const href = value.trim();
  if (href.startsWith("#") || href.startsWith("/") || href.startsWith("./")) {
    return href;
  }
  try {
    const protocol = new URL(href).protocol;
    return protocol === "https:" ||
      protocol === "http:" ||
      protocol === "mailto:"
      ? href
      : undefined;
  } catch {
    return undefined;
  }
};

const safeImageSource = (value: string): string | undefined => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:" ? value : undefined;
  } catch {
    return undefined;
  }
};

const definitionMap = (root: Root): Definitions =>
  new Map(
    root.children.flatMap((node) =>
      node.type === "definition" ? [[node.identifier.toLowerCase(), node]] : [],
    ),
  );

const heading = (
  depth: 1 | 2 | 3 | 4 | 5 | 6,
  children: ReadonlyArray<MarkdownChild>,
  h: HtmlBuilder<Message>,
) => {
  switch (depth) {
    case 1:
      return h.h1([], children);
    case 2:
      return h.h2([], children);
    case 3:
      return h.h3([], children);
    case 4:
      return h.h4([], children);
    case 5:
      return h.h5([], children);
    case 6:
      return h.h6([], children);
  }
  return depth satisfies never;
};

const tableRow = (
  row: TableRow,
  header: boolean,
  definitions: Definitions,
  h: HtmlBuilder<Message>,
) =>
  h.tr(
    [],
    row.children.map((cell) =>
      header
        ? h.th([], renderNodes(cell.children, definitions, h))
        : h.td([], renderNodes(cell.children, definitions, h)),
    ),
  );

const renderNode = (
  node: RootContent,
  definitions: Definitions,
  h: HtmlBuilder<Message>,
): MarkdownChild => {
  switch (node.type) {
    case "text":
      return node.value;
    case "paragraph":
      return h.p([], renderNodes(node.children, definitions, h));
    case "strong":
      return h.strong([], renderNodes(node.children, definitions, h));
    case "emphasis":
      return h.em([], renderNodes(node.children, definitions, h));
    case "delete":
      return h.del([], renderNodes(node.children, definitions, h));
    case "inlineCode":
      return h.code([h.Class("markdown-inline-code")], [node.value]);
    case "code": {
      const language = node.lang?.match(/^[a-zA-Z0-9_+-]+$/)?.[0];
      return h.pre(
        [h.Class("markdown-code-block")],
        [
          h.code(
            language === undefined ? [] : [h.Class(`language-${language}`)],
            [node.value],
          ),
        ],
      );
    }
    case "break":
      return h.br([]);
    case "thematicBreak":
      return h.hr([]);
    case "blockquote":
      return h.blockquote([], renderNodes(node.children, definitions, h));
    case "heading":
      return heading(node.depth, renderNodes(node.children, definitions, h), h);
    case "list": {
      const attributes =
        node.ordered && node.start !== null && node.start !== undefined
          ? [h.Start(node.start)]
          : [];
      const children = renderNodes(node.children, definitions, h);
      return node.ordered ? h.ol(attributes, children) : h.ul([], children);
    }
    case "listItem": {
      // Markdown task markers are inert rendered content, not form controls.
      const checkbox =
        typeof node.checked === "boolean"
          ? h.input([
              h.Type("checkbox"),
              h.Checked(node.checked),
              h.Disabled(true),
              h.AriaLabel(node.checked ? "Completed" : "Not completed"),
            ])
          : h.empty;
      return h.li(
        node.checked === null || node.checked === undefined
          ? []
          : [h.Class("task-list-item")],
        [checkbox, ...renderNodes(node.children, definitions, h)],
      );
    }
    case "link": {
      const children = renderNodes(node.children, definitions, h);
      const href = safeHref(node.url);
      if (href === undefined) {
        return h.span([], children);
      }
      const title =
        node.title === null || node.title === undefined
          ? []
          : [h.Title(node.title)];
      return href.startsWith("http")
        ? h.a(
            [
              h.Href(href),
              h.Target("_blank"),
              h.Rel("noopener noreferrer"),
              ...title,
            ],
            children,
          )
        : h.a([h.Href(href), ...title], children);
    }
    case "linkReference": {
      const definition = definitions.get(node.identifier.toLowerCase());
      return definition === undefined
        ? h.span([], renderNodes(node.children, definitions, h))
        : renderNode(
            {
              type: "link",
              url: definition.url,
              title: definition.title,
              children: node.children,
            },
            definitions,
            h,
          );
    }
    case "image": {
      const source = safeImageSource(node.url);
      return source === undefined
        ? (node.alt ?? "")
        : h.img([
            h.Src(source),
            h.Alt(node.alt ?? ""),
            ...(node.title === null || node.title === undefined
              ? []
              : [h.Title(node.title)]),
          ]);
    }
    case "imageReference": {
      const definition = definitions.get(node.identifier.toLowerCase());
      return definition === undefined
        ? (node.alt ?? "")
        : renderNode(
            {
              type: "image",
              url: definition.url,
              title: definition.title,
              alt: node.alt,
            },
            definitions,
            h,
          );
    }
    case "table": {
      const [header, ...body] = node.children;
      return h.table(
        [],
        [
          header === undefined
            ? h.empty
            : h.thead([], [tableRow(header, true, definitions, h)]),
          EffectArray.match(body, {
            onEmpty: () => h.empty,
            onNonEmpty: (rows) =>
              h.tbody(
                [],
                EffectArray.map(rows, (row) =>
                  tableRow(row, false, definitions, h),
                ),
              ),
          }),
        ],
      );
    }
    case "tableRow":
      return tableRow(node, false, definitions, h);
    case "tableCell":
      return h.td([], renderNodes(node.children, definitions, h));
    case "footnoteReference":
      return h.sup([], [`[${node.label ?? node.identifier}]`]);
    case "footnoteDefinition":
      return h.div(
        [h.Class("markdown-footnote")],
        [
          h.sup([], [`[${node.label ?? node.identifier}]`]),
          ...renderNodes(node.children, definitions, h),
        ],
      );
    case "html":
    case "yaml":
      return h.code([h.Class("markdown-raw")], [node.value]);
    case "definition":
      return h.empty;
  }
  return node satisfies never;
};

const renderNodes = (
  nodes: ReadonlyArray<RootContent>,
  definitions: Definitions,
  h: HtmlBuilder<Message>,
): ReadonlyArray<MarkdownChild> =>
  nodes.map((node) => renderNode(node, definitions, h));

export const markdownView = (source: string, h: HtmlBuilder<Message>): Html => {
  const root = parseMarkdown(source);
  return h.div(
    [h.Class("github-comment-markdown")],
    renderNodes(root.children, definitionMap(root), h),
  );
};
