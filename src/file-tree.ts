export type FileTreeNode<A> = FileTreeDirectory<A> | FileTreeFile<A>;

export type FileTreeDirectory<A> = Readonly<{
  _tag: "Directory";
  name: string;
  path: string;
  fileCount: number;
  children: ReadonlyArray<FileTreeNode<A>>;
}>;

export type FileTreeFile<A> = Readonly<{
  _tag: "File";
  name: string;
  path: string;
  value: A;
}>;

type DraftDirectory<A> = {
  readonly name: string;
  readonly path: string;
  readonly directories: Map<string, DraftDirectory<A>>;
  readonly files: Array<FileTreeFile<A>>;
};

const draftDirectory = <A>(name: string, path: string): DraftDirectory<A> => ({
  name,
  path,
  directories: new Map(),
  files: [],
});

const byName = <A>(left: FileTreeNode<A>, right: FileTreeNode<A>) =>
  left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });

const finishDirectory = <A>(draft: DraftDirectory<A>): FileTreeDirectory<A> => {
  const directories = [...draft.directories.values()]
    .map(finishDirectory)
    .toSorted(byName);
  const files = draft.files.toSorted(byName);
  const children = [...directories, ...files];
  return {
    _tag: "Directory",
    name: draft.name,
    path: draft.path,
    fileCount: children.reduce(
      (total, child) =>
        total + (child._tag === "Directory" ? child.fileCount : 1),
      0,
    ),
    children,
  };
};

export const buildFileTree = <A>(
  files: ReadonlyArray<A>,
  pathOf: (file: A) => string,
): ReadonlyArray<FileTreeNode<A>> => {
  const root = draftDirectory<A>("", "");
  for (const value of files) {
    const path = pathOf(value);
    const segments = path.split("/").filter((segment) => segment !== "");
    const name = segments.at(-1);
    if (name === undefined) continue;
    let directory = root;
    for (const segment of segments.slice(0, -1)) {
      const childPath =
        directory.path === "" ? segment : `${directory.path}/${segment}`;
      const existing = directory.directories.get(segment);
      if (existing !== undefined) {
        directory = existing;
      } else {
        const created = draftDirectory<A>(segment, childPath);
        directory.directories.set(segment, created);
        directory = created;
      }
    }
    directory.files.push({ _tag: "File", name, path, value });
  }
  return finishDirectory(root).children;
};

export const parentFolderPaths = (path: string): ReadonlyArray<string> => {
  const segments = path.split("/").filter((segment) => segment !== "");
  return segments
    .slice(0, -1)
    .map((_, index) => segments.slice(0, index + 1).join("/"));
};

export const revealFileInTree = (
  collapsedFolders: ReadonlyArray<string>,
  path: string,
): ReadonlyArray<string> => {
  const parents = new Set(parentFolderPaths(path));
  return collapsedFolders.filter((folder) => !parents.has(folder));
};
