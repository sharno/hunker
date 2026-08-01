import { Context, Data, Effect, Layer } from "effect";

import {
  MovedBlock,
  SemanticResult,
  type SemanticChange,
} from "../src/domain";
import type { FileDescriptor } from "./github";
import {
  languageForPath,
  parseUnits,
  uniqueBy,
  type AstUnit,
  type SupportedLanguage,
} from "./ast-grep-analysis";

export type FilePair = FileDescriptor &
  Readonly<{
    oldText: string;
    newText: string;
  }>;

type LocatedUnit = AstUnit &
  Readonly<{
    path: string;
    pairIndex: number;
  }>;

type SemanticDiffEngineShape = Readonly<{
  analyzeFile: (file: FilePair) => Effect.Effect<SemanticResult>;
  analyzeReview: (
    files: ReadonlyArray<FilePair>,
  ) => Effect.Effect<ReadonlyArray<MovedBlock>, SemanticEngineFailed>;
}>;

export class SemanticEngineFailed extends Data.TaggedError("SemanticEngineFailed")<{
  readonly message: string;
  readonly status: number;
}> {}

export class SemanticDiffEngine extends Context.Service<
  SemanticDiffEngine,
  SemanticDiffEngineShape
>()("hunker/SemanticDiffEngine") {}

const analyzeParsedFile = (
  path: string,
  language: SupportedLanguage,
  oldText: string,
  newText: string,
): SemanticResult => {
  const before = parseUnits(language, oldText, false);
  const after = parseUnits(language, newText, false);
  if (before.parseFailed || after.parseFailed) {
    return SemanticResult.make({
      _tag: "ParseFailed",
      path,
      language: language.name,
      reason: "ast-grep found an incomplete syntax tree, so the regular patch is shown.",
    });
  }

  const oldRemaining = new Set(before.units);
  const newRemaining = new Set(after.units);
  const changes: Array<SemanticChange> = [];

  const consumeUnique = (
    oldKey: (unit: AstUnit) => string,
    newKey: (unit: AstUnit) => string,
    onPair: (oldUnit: AstUnit, newUnit: AstUnit) => void,
  ) => {
    const oldUnique = uniqueBy([...oldRemaining], oldKey);
    const newUnique = uniqueBy([...newRemaining], newKey);
    for (const [key, oldUnit] of oldUnique) {
      const newUnit = newUnique.get(key);
      if (newUnit === undefined) continue;
      oldRemaining.delete(oldUnit);
      newRemaining.delete(newUnit);
      onPair(oldUnit, newUnit);
    }
  };

  consumeUnique(
    unit => unit.exactFingerprint,
    unit => unit.exactFingerprint,
    () => undefined,
  );
  consumeUnique(
    unit => `${unit.kind}|${unit.label}`,
    unit => `${unit.kind}|${unit.label}`,
    (oldUnit, newUnit) =>
      changes.push({
        _tag: "Updated",
        kind: oldUnit.kind,
        label: oldUnit.label,
        oldRange: oldUnit.range,
        newRange: newUnit.range,
        confidence: 1,
      }),
  );
  consumeUnique(
    unit => unit.shapeFingerprint,
    unit => unit.shapeFingerprint,
    (oldUnit, newUnit) =>
      changes.push({
        _tag: "Renamed",
        kind: oldUnit.kind,
        oldLabel: oldUnit.label,
        newLabel: newUnit.label,
        oldRange: oldUnit.range,
        newRange: newUnit.range,
        confidence: 0.85,
      }),
  );

  for (const unit of oldRemaining) {
    changes.push({
      _tag: "Deleted",
      kind: unit.kind,
      label: unit.label,
      oldRange: unit.range,
      confidence: 1,
    });
  }
  for (const unit of newRemaining) {
    changes.push({
      _tag: "Inserted",
      kind: unit.kind,
      label: unit.label,
      newRange: unit.range,
      confidence: 1,
    });
  }

  return SemanticResult.make({
    _tag: "Parsed",
    path,
    language: language.name,
    semanticEqual: before.fingerprint === after.fingerprint,
    changes,
  });
};

const fileOldPath = (file: FilePair) =>
  file.status === "renamed" && file.previousPath !== ""
    ? file.previousPath
    : file.path;

const locatedUnits = (
  files: ReadonlyArray<FilePair>,
  side: "old" | "new",
): ReadonlyArray<LocatedUnit> =>
  files.flatMap((file, pairIndex) => {
    const language = languageForPath(file.path);
    const source = side === "old" ? file.oldText : file.newText;
    if (language === undefined || source === "") return [];
    const parsed = parseUnits(language, source, true);
    if (parsed.parseFailed) return [];
    const path = side === "old" ? fileOldPath(file) : file.path;
    return parsed.units.map(unit => ({ ...unit, path, pairIndex }));
  });

const isContainedMove = (move: MovedBlock, oldUnit: LocatedUnit, newUnit: LocatedUnit) =>
  move.fromPath === oldUnit.path &&
  move.toPath === newUnit.path &&
  oldUnit.range.startLine >= move.fromLine &&
  oldUnit.range.endLine < move.fromLine + move.lineCount &&
  newUnit.range.startLine >= move.toLine &&
  newUnit.range.endLine < move.toLine + move.lineCount;

const longestIncreasingIndexes = (values: ReadonlyArray<number>) => {
  const tails: Array<number> = [];
  const previous = values.map(() => -1);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) continue;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const tailIndex = tails[middle];
      if (tailIndex !== undefined && (values[tailIndex] ?? -1) < value) low = middle + 1;
      else high = middle;
    }
    previous[index] = low > 0 ? (tails[low - 1] ?? -1) : -1;
    tails[low] = index;
  }
  const indexes = new Set<number>();
  let cursor = tails.at(-1) ?? -1;
  while (cursor >= 0) {
    indexes.add(cursor);
    cursor = previous[cursor] ?? -1;
  }
  return indexes;
};

const detectReviewMoves = (files: ReadonlyArray<FilePair>) => {
  const oldUnits = locatedUnits(files, "old");
  const newUnits = locatedUnits(files, "new");
  const oldRemaining = new Set(oldUnits);
  const newRemaining = new Set(newUnits);
  const moves: Array<MovedBlock> = [];

  const match = (fingerprint: (unit: LocatedUnit) => string, changed: boolean) => {
    const oldUnique = uniqueBy([...oldRemaining], fingerprint);
    const newUnique = uniqueBy([...newRemaining], fingerprint);
    const pairs = [...oldUnique].flatMap(([key, oldUnit]) => {
      const newUnit = newUnique.get(key);
      return newUnit === undefined ? [] : [{ oldUnit, newUnit }];
    });
    pairs.sort(
      (left, right) => right.oldUnit.text.length - left.oldUnit.text.length,
    );
    const stableInFile = new Set<(typeof pairs)[number]>();
    if (!changed) {
      const sameFilePairs = new Map<number, Array<(typeof pairs)[number]>>();
      for (const pair of pairs) {
        if (pair.oldUnit.pairIndex !== pair.newUnit.pairIndex) continue;
        const pairIndex = pair.oldUnit.pairIndex;
        sameFilePairs.set(pairIndex, [...(sameFilePairs.get(pairIndex) ?? []), pair]);
      }
      for (const filePairs of sameFilePairs.values()) {
        const ordered = [...filePairs].sort(
          (left, right) => left.oldUnit.order - right.oldUnit.order,
        );
        const stableIndexes = longestIncreasingIndexes(
          ordered.map(pair => pair.newUnit.order),
        );
        for (const index of stableIndexes) {
          const pair = ordered[index];
          if (pair !== undefined) stableInFile.add(pair);
        }
      }
    }
    for (const pair of pairs) {
      const { oldUnit, newUnit } = pair;
      oldRemaining.delete(oldUnit);
      newRemaining.delete(newUnit);
      const differentFilePair = oldUnit.pairIndex !== newUnit.pairIndex;
      const reorderedInFile = !changed && !differentFilePair && !stableInFile.has(pair);
      if (!differentFilePair && !reorderedInFile) continue;
      if (moves.some(move => isContainedMove(move, oldUnit, newUnit))) continue;
      moves.push(
        MovedBlock.make({
          fromPath: oldUnit.path,
          toPath: newUnit.path,
          fromLine: oldUnit.range.startLine,
          toLine: newUnit.range.startLine,
          lineCount: Math.max(1, oldUnit.range.endLine - oldUnit.range.startLine + 1),
          preview: oldUnit.preview,
          kind: oldUnit.kind,
          label: changed ? `${oldUnit.label} → ${newUnit.label}` : oldUnit.label,
          confidence: changed ? 0.8 : 1,
          changed,
        }),
      );
    }
  };

  match(unit => unit.exactFingerprint, false);
  match(unit => unit.shapeFingerprint, true);
  return moves;
};

const engine = SemanticDiffEngine.of({
  analyzeFile: file =>
    Effect.sync(() => {
      const language = languageForPath(file.path);
      if (language === undefined) {
        return SemanticResult.make({
          _tag: "Unsupported",
          path: file.path,
          reason: "ast-grep semantic analysis currently supports JavaScript, TypeScript, Python, Rust, and OpenTofu/HCL.",
        });
      }
      try {
        return analyzeParsedFile(file.path, language, file.oldText, file.newText);
      } catch {
        return SemanticResult.make({
          _tag: "ParseFailed",
          path: file.path,
          language: language.name,
          reason: "ast-grep could not parse this file, so the regular patch is shown.",
        });
      }
    }),
  analyzeReview: files =>
    Effect.try({
      try: () => detectReviewMoves(files),
      catch: () =>
        new SemanticEngineFailed({
          message: "ast-grep could not scan this review's syntax trees.",
          status: 502,
        }),
    }),
});

export const AstGrepSemanticLive = Layer.succeed(SemanticDiffEngine, engine);
