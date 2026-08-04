import { expect, test } from "@playwright/test";
import { Effect } from "effect";

import {
  SemanticDiffEngine,
  type FilePair,
  layer as semanticDiffLayer,
} from "../backend/semantic-engine";
import { runWithLayer } from "./effect-runtime";

const runFile = (file: FilePair) => {
  const analysis = Effect.gen(function* () {
    const engine = yield* SemanticDiffEngine;
    return yield* engine.analyzeFile(file);
  });
  return runWithLayer(semanticDiffLayer, analysis);
};

const runReview = (files: ReadonlyArray<FilePair>) => {
  const analysis = Effect.gen(function* () {
    const engine = yield* SemanticDiffEngine;
    return yield* engine.analyzeReview(files);
  });
  return runWithLayer(semanticDiffLayer, analysis);
};

test("classifies a changed TypeScript declaration", async () => {
  const result = await runFile({
    path: "src/greet.ts",
    previousPath: "",
    status: "modified",
    oldText:
      'export function greet(name: string) {\n  const message = "hello " + name;\n  return message;\n}\n',
    newText:
      "export function greet(person: string) {\n  return `hello ${person}`;\n}\n",
  });

  expect(result._tag).toBe("Parsed");
  if (result._tag !== "Parsed") return;
  expect(result.language).toBe("TypeScript");
  expect(result.semanticEqual).toBe(false);
  expect(result.changes).toEqual([
    expect.objectContaining({
      _tag: "Updated",
      kind: "function_declaration",
      label: "greet",
    }),
  ]);
});

test("recognizes formatting-only changes as semantically equal", async () => {
  const result = await runFile({
    path: "src/answer.ts",
    previousPath: "",
    status: "modified",
    oldText: "export const answer=42;\n",
    newText: "export const answer = 42;\n",
  });

  expect(result).toEqual(
    expect.objectContaining({
      _tag: "Parsed",
      semanticEqual: true,
      changes: [],
    }),
  );
});

test("recognizes a declaration rename from its AST shape", async () => {
  const result = await runFile({
    path: "src/greet.ts",
    previousPath: "",
    status: "modified",
    oldText: "export function greet(name: string) { return name; }\n",
    newText: "export function welcome(person: string) { return person; }\n",
  });

  expect(result._tag).toBe("Parsed");
  if (result._tag !== "Parsed") return;
  expect(result.changes).toEqual([
    expect.objectContaining({
      _tag: "Renamed",
      oldLabel: "greet",
      newLabel: "welcome",
    }),
  ]);
});

test("detects a declaration moved between files without a subprocess", async () => {
  const moved = `export function calculateTotal(values: number[]) {
  const subtotal = values.reduce((sum, value) => sum + value, 0);
  const tax = subtotal * 0.2;
  return subtotal + tax;
}
`;
  const result = await runReview([
    {
      path: "src/total.ts",
      previousPath: "",
      status: "modified",
      oldText: `export const retained = true;\n\n${moved}`,
      newText: "export const retained = true;\n",
    },
    {
      path: "src/billing.ts",
      previousPath: "",
      status: "modified",
      oldText: 'export const moduleName = "billing";\n',
      newText: `export const moduleName = "billing";\n\n${moved}`,
    },
  ]);

  expect(result).toEqual([
    {
      fromPath: "src/total.ts",
      toPath: "src/billing.ts",
      fromLine: 3,
      toLine: 3,
      lineCount: 5,
      preview: "function calculateTotal(values: number[]) {",
      kind: "function_declaration",
      label: "calculateTotal",
      confidence: 1,
      changed: false,
    },
  ]);
});

test("does not mistake declarations shifted by an insertion for moves", async () => {
  const before = `export const first = 1;
export const second = 2;
export const third = 3;
`;
  const after = `export const inserted = 0;
${before}`;
  const result = await runReview([
    {
      path: "src/constants.ts",
      previousPath: "",
      status: "modified",
      oldText: before,
      newText: after,
    },
  ]);

  expect(result).toEqual([]);
});

test("classifies changed and renamed Rust declarations", async () => {
  const updated = await runFile({
    path: "src/greeting.rs",
    previousPath: "",
    status: "modified",
    oldText: "pub fn greet(name: &str) -> usize { name.len() }\n",
    newText: "pub fn greet(name: &str) -> usize { name.trim().len() }\n",
  });
  expect(updated._tag).toBe("Parsed");
  if (updated._tag !== "Parsed") return;
  expect(updated.language).toBe("Rust");
  expect(updated.changes).toEqual([
    expect.objectContaining({
      _tag: "Updated",
      kind: "function_item",
      label: "greet",
    }),
  ]);

  const renamed = await runFile({
    path: "src/greeting.rs",
    previousPath: "",
    status: "modified",
    oldText: "pub fn greet(name: &str) -> String { name.to_owned() }\n",
    newText: "pub fn welcome(person: &str) -> String { person.to_owned() }\n",
  });
  expect(renamed._tag).toBe("Parsed");
  if (renamed._tag !== "Parsed") return;
  expect(renamed.changes).toEqual([
    expect.objectContaining({
      _tag: "Renamed",
      kind: "function_item",
      oldLabel: "greet",
      newLabel: "welcome",
    }),
  ]);
});

test("recognizes formatting-only Rust changes as semantically equal", async () => {
  const result = await runFile({
    path: "src/lib.rs",
    previousPath: "",
    status: "modified",
    oldText: "pub const ANSWER:i32=42;\n",
    newText: "pub const ANSWER: i32 = 42;\n",
  });

  expect(result).toEqual(
    expect.objectContaining({
      _tag: "Parsed",
      language: "Rust",
      semanticEqual: true,
      changes: [],
    }),
  );
});

test("detects a Rust function moved between files", async () => {
  const moved = `pub fn calculate_total(values: &[i64]) -> i64 {
    values.iter().sum()
}
`;
  const result = await runReview([
    {
      path: "src/total.rs",
      previousPath: "",
      status: "modified",
      oldText: `pub const RETAINED: bool = true;\n\n${moved}`,
      newText: "pub const RETAINED: bool = true;\n",
    },
    {
      path: "src/billing.rs",
      previousPath: "",
      status: "modified",
      oldText: 'pub const MODULE_NAME: &str = "billing";\n',
      newText: `pub const MODULE_NAME: &str = "billing";\n\n${moved}`,
    },
  ]);

  expect(result).toEqual([
    expect.objectContaining({
      fromPath: "src/total.rs",
      toPath: "src/billing.rs",
      fromLine: 3,
      toLine: 3,
      lineCount: 3,
      kind: "function_item",
      label: "calculate_total",
      changed: false,
    }),
  ]);
});

test("classifies changed and renamed Python declarations", async () => {
  const updated = await runFile({
    path: "src/greeting.py",
    previousPath: "",
    status: "modified",
    oldText: `@dataclass
class Greeting:
    name: str
`,
    newText: `@dataclass
class Greeting:
    name: str
    excited: bool = False
`,
  });
  expect(updated._tag).toBe("Parsed");
  if (updated._tag !== "Parsed") return;
  expect(updated.language).toBe("Python");
  expect(updated.changes).toEqual([
    expect.objectContaining({
      _tag: "Updated",
      kind: "decorated_definition",
      label: "Greeting",
    }),
  ]);

  const renamed = await runFile({
    path: "src/greeting.py",
    previousPath: "",
    status: "modified",
    oldText: "def greet(name: str) -> str:\n    return name.upper()\n",
    newText: "def welcome(person: str) -> str:\n    return person.upper()\n",
  });
  expect(renamed._tag).toBe("Parsed");
  if (renamed._tag !== "Parsed") return;
  expect(renamed.changes).toEqual([
    expect.objectContaining({
      _tag: "Renamed",
      kind: "function_definition",
      oldLabel: "greet",
      newLabel: "welcome",
    }),
  ]);
});

test("recognizes formatting-only Python changes as semantically equal", async () => {
  const result = await runFile({
    path: "src/math.py",
    previousPath: "",
    status: "modified",
    oldText: "def add(value:int)->int:\n return value+1\n",
    newText: "def add(value: int) -> int:\n    return value + 1\n",
  });

  expect(result).toEqual(
    expect.objectContaining({
      _tag: "Parsed",
      language: "Python",
      semanticEqual: true,
      changes: [],
    }),
  );
});

test("detects a Python function moved between files", async () => {
  const moved = `def calculate_total(values: list[int]) -> int:
    return sum(values)
`;
  const result = await runReview([
    {
      path: "src/total.py",
      previousPath: "",
      status: "modified",
      oldText: `RETAINED = True\n\n${moved}`,
      newText: "RETAINED = True\n",
    },
    {
      path: "src/billing.py",
      previousPath: "",
      status: "modified",
      oldText: 'MODULE_NAME = "billing"\n',
      newText: `MODULE_NAME = "billing"\n\n${moved}`,
    },
  ]);

  expect(result).toEqual([
    expect.objectContaining({
      fromPath: "src/total.py",
      toPath: "src/billing.py",
      fromLine: 3,
      toLine: 3,
      lineCount: 2,
      kind: "function_definition",
      label: "calculate_total",
      changed: false,
    }),
  ]);
});

test("classifies changed and renamed OpenTofu blocks", async () => {
  const updated = await runFile({
    path: "infra/main.tofu",
    previousPath: "",
    status: "modified",
    oldText: `resource "aws_s3_bucket" "logs" {
  bucket = "logs-example"
}
`,
    newText: `resource "aws_s3_bucket" "logs" {
  bucket = "logs-production"
}
`,
  });
  expect(updated._tag).toBe("Parsed");
  if (updated._tag !== "Parsed") return;
  expect(updated.language).toBe("OpenTofu / HCL");
  expect(updated.changes).toEqual([
    expect.objectContaining({
      _tag: "Updated",
      kind: "block",
      label: "resource aws_s3_bucket.logs",
    }),
  ]);

  const renamed = await runFile({
    path: "infra/main.tf",
    previousPath: "",
    status: "modified",
    oldText: `module "api" {
  source = "./service"
}
`,
    newText: `module "server" {
  source = "./service"
}
`,
  });
  expect(renamed._tag).toBe("Parsed");
  if (renamed._tag !== "Parsed") return;
  expect(renamed.changes).toEqual([
    expect.objectContaining({
      _tag: "Renamed",
      kind: "block",
      oldLabel: "module api",
      newLabel: "module server",
    }),
  ]);
});

test("recognizes formatting-only OpenTofu changes as semantically equal", async () => {
  const result = await runFile({
    path: "infra/variables.tofu",
    previousPath: "",
    status: "modified",
    oldText: `variable "region" {
 type=string
 default="us-east-1"
}
`,
    newText: `variable "region" {
  type    = string
  default = "us-east-1"
}
`,
  });

  expect(result).toEqual(
    expect.objectContaining({
      _tag: "Parsed",
      language: "OpenTofu / HCL",
      semanticEqual: true,
      changes: [],
    }),
  );
});

test("detects an OpenTofu resource moved between files", async () => {
  const moved = `resource "aws_s3_bucket" "logs" {
  bucket = "logs-example"
}
`;
  const result = await runReview([
    {
      path: "infra/storage.tf",
      previousPath: "",
      status: "modified",
      oldText: `locals {\n  retained = true\n}\n\n${moved}`,
      newText: "locals {\n  retained = true\n}\n",
    },
    {
      path: "infra/main.tofu",
      previousPath: "",
      status: "modified",
      oldText: 'provider "aws" {\n  region = "us-east-1"\n}\n',
      newText: `provider "aws" {\n  region = "us-east-1"\n}\n\n${moved}`,
    },
  ]);

  expect(result).toEqual([
    expect.objectContaining({
      fromPath: "infra/storage.tf",
      toPath: "infra/main.tofu",
      fromLine: 5,
      toLine: 5,
      lineCount: 3,
      kind: "block",
      label: "resource aws_s3_bucket.logs",
      changed: false,
    }),
  ]);
});
