import type { Html, HtmlBuilder } from "foldkit/html";

import { buildFileTree } from "../file-tree";
import type { FileTreeNode } from "../file-tree";

type FileTreeViewInput<A, Message> = Readonly<{
  files: ReadonlyArray<A>;
  pathOf: (file: A) => string;
  collapsedFolders: ReadonlyArray<string>;
  onToggleFolder: (path: string) => Message;
  renderFile: (file: A, name: string, h: HtmlBuilder<Message>) => Html;
}>;

export const fileTreeView = <A, Message>(
  input: FileTreeViewInput<A, Message>,
  h: HtmlBuilder<Message>,
): Html => {
  const collapsed = new Set(input.collapsedFolders);

  const renderNodes = (nodes: ReadonlyArray<FileTreeNode<A>>): Html =>
    h.div(
      [h.Class("file-tree"), h.Role("group")],
      nodes.map((node) => {
        if (node._tag === "File") {
          return h.div(
            [h.Key(`file:${node.path}`), h.Class("file-tree-leaf")],
            [input.renderFile(node.value, node.name, h)],
          );
        }
        const isCollapsed = collapsed.has(node.path);
        return h.div(
          [
            h.Key(`directory:${node.path}`),
            h.Class(`file-tree-directory${isCollapsed ? " is-collapsed" : ""}`),
          ],
          [
            h.button(
              [
                h.Type("button"),
                h.Class("file-tree-folder"),
                h.AriaExpanded(!isCollapsed),
                h.AriaLabel(
                  `${isCollapsed ? "Expand" : "Collapse"} ${node.path}`,
                ),
                h.Title(node.path),
                h.OnClick(input.onToggleFolder(node.path)),
              ],
              [
                h.span(
                  [h.Class("file-tree-chevron")],
                  [isCollapsed ? "›" : "⌄"],
                ),
                h.span([h.Class("file-tree-folder-icon")], ["▰"]),
                h.span([h.Class("file-tree-folder-name")], [node.name]),
                h.small(
                  [h.Class("file-tree-folder-count")],
                  [String(node.fileCount)],
                ),
              ],
            ),
            isCollapsed ? h.empty : renderNodes(node.children),
          ],
        );
      }),
    );

  return renderNodes(buildFileTree(input.files, input.pathOf));
};
