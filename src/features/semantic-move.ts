import type { MovedBlock } from "../model";

export type SemanticMoveEndpoint = "source" | "destination";

export const semanticMoveKey = (move: MovedBlock) =>
  `${move.fromPath}:${move.fromLine}->${move.toPath}:${move.toLine}:${move.kind}:${move.label}`;

const stableHash = (value: string) => {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

export const semanticMoveId = (move: MovedBlock) =>
  stableHash(semanticMoveKey(move)).toString(36);

export const semanticMoveAnchor = (
  move: MovedBlock,
  endpoint: SemanticMoveEndpoint,
) => `semantic-move-${semanticMoveId(move)}-${endpoint}`;

export const semanticMoveTone = (move: MovedBlock) =>
  stableHash(semanticMoveKey(move)) % 3;
