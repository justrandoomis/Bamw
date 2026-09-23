import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "espree";
import { describe, expect, it } from "vitest";

/**
 * A `const` used above the line that defines it.
 *
 * `node --check` does not catch this — the file parses, and the crash only
 * arrives at runtime as "Cannot access 'x' before initialization". That is
 * exactly how a merge script that writes to production got as far as being
 * dispatched with `--apply` before failing. These scripts are run against real
 * data from a workflow, so the cheapest place to catch it is here.
 *
 * ## THIS FILE USED A REGULAR EXPRESSION, AND IT MISSED ONE
 *
 * The first version compared only lines starting at column zero, on the
 * reasoning that «module-level statements start at column zero». They do not.
 * A top-level `if`/`else`, `for` or `try` runs at module level too, and its
 * body is INDENTED — so a call inside one was invisible here. I put a `check(…)`
 * inside such an `else` in the production checker, `node --check` said the file
 * parsed, this test said the file was clean, and the run died on the runner
 * with «Cannot access 'check' before initialization» after it had already read
 * the shelf it was sent to read.
 *
 * So it parses now, with the parser ESLint itself uses, and walks the tree:
 *
 *   - a reference inside a FUNCTION is not a hazard. The function body runs
 *     when it is called, which is normally after everything is initialised —
 *     this is the case the regex was written to avoid and the reason this was
 *     never just `no-use-before-define`, which flags twelve of these across
 *     four scripts that are all perfectly correct;
 *   - a reference anywhere else runs top to bottom, whatever its indentation;
 *   - a name redeclared by an inner block is that block's own, not the module's;
 *   - and `import { present as presentCell }` mentions `present` without
 *     referring to anything at all.
 *
 * The last two are not hypothetical: the first tree-walking version I wrote
 * reported both as hazards, in `db-console.mjs` and `deployment-state.mjs`, and
 * neither was one.
 */

/** Node types whose body executes only when somebody calls them. */
const FUNCTIONS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/** Node types that open a scope a `const`/`let` can be private to. */
const BLOCKS = new Set([
  "BlockStatement",
  "ForStatement",
  "ForOfStatement",
  "ForInStatement",
  "SwitchStatement",
  "StaticBlock",
]);

/** The `const`/`let` names a node declares directly, without descending. */
const namesDeclaredIn = (node) => {
  const names = [];
  const add = (id) => {
    if (!id) return;
    if (id.type === "Identifier") names.push(id.name);
    else if (id.type === "ObjectPattern") id.properties.forEach((p) => add(p.value ?? p.argument));
    else if (id.type === "ArrayPattern") id.elements.forEach((e) => add(e));
    else if (id.type === "AssignmentPattern") add(id.left);
    else if (id.type === "RestElement") add(id.argument);
  };
  const statements =
    node.type === "SwitchStatement"
      ? node.cases.flatMap((c) => c.consequent)
      : (node.body ?? []);
  for (const statement of Array.isArray(statements) ? statements : []) {
    if (statement.type !== "VariableDeclaration") continue;
    if (statement.kind !== "const" && statement.kind !== "let") continue;
    statement.declarations.forEach((d) => add(d.id));
  }
  /* A `for (const x of …)` head belongs to the loop, not to the module. */
  if (node.left?.type === "VariableDeclaration") node.left.declarations.forEach((d) => add(d.id));
  if (node.init?.type === "VariableDeclaration") node.init.declarations.forEach((d) => add(d.id));
  return names;
};

export function hazards(source) {
  let tree;
  try {
    tree = parse(source, { ecmaVersion: "latest", sourceType: "module", range: true, loc: true });
  } catch {
    /* A file that will not parse fails elsewhere, loudly. Not this file's job. */
    return [];
  }

  /** Module-level `const`/`let`, and where each one is initialised. */
  const declared = new Map();
  for (const node of tree.body) {
    if (node.type !== "VariableDeclaration") continue;
    if (node.kind !== "const" && node.kind !== "let") continue;
    for (const d of node.declarations) {
      if (d.id.type === "Identifier" && !declared.has(d.id.name)) {
        declared.set(d.id.name, { start: node.range[0], line: node.loc.start.line });
      }
    }
  }

  const found = [];
  const reported = new Set();

  const visit = (node, inFunction, shadowed) => {
    if (!node || typeof node.type !== "string") return;

    if (FUNCTIONS.has(node.type)) inFunction = true;
    if (!inFunction && BLOCKS.has(node.type)) {
      const own = namesDeclaredIn(node);
      if (own.length) shadowed = new Set([...shadowed, ...own]);
    }

    if (!inFunction && node.type === "Identifier" && !shadowed.has(node.name)) {
      const decl = declared.get(node.name);
      if (decl && node.range[0] < decl.start && !reported.has(node.name)) {
        reported.add(node.name);
        found.push({ name: node.name, useLine: node.loc.start.line, defLine: decl.line });
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "range" || key === "loc" || key === "parent") continue;
      /* `a.b` mentions `b`; it does not reference a variable called `b`. */
      if (node.type === "MemberExpression" && key === "property" && !node.computed) continue;
      if (node.type === "Property" && key === "key" && !node.computed) continue;
      /* `import { present as presentCell }` names the EXPORT, not a variable. */
      if (node.type === "ImportSpecifier" && key === "imported") continue;
      if ((node.type === "ExportSpecifier" || node.type === "ImportSpecifier") && key === "exported")
        continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach((child) => visit(child, inFunction, shadowed));
      else if (value && typeof value === "object") visit(value, inFunction, shadowed);
    }
  };

  visit(tree, false, new Set());
  return found;
}

const dir = path.resolve("scripts");
const files = readdirSync(dir).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"));
const libDir = path.join(dir, "lib");
const libFiles = readdirSync(libDir)
  .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
  .map((f) => path.join("lib", f));

describe("scripts have no temporal dead zone hazards", () => {
  it("finds the pattern it exists to catch", () => {
    const broken = `const out = await step("x", work);\nconst step = async (l, w) => w();\n`;
    expect(hazards(broken).map((h) => h.name)).toEqual(["step"]);
  });

  /*
    THE ONE THE OLD VERSION MISSED, and the reason this file was rewritten. The
    call is indented because it is inside a top-level `else`; it still runs at
    module level, before the line that defines what it calls.
  */
  it("finds one inside a top-level block, where the indentation lied", () => {
    const broken = `if (process.argv[2]) {\n  check("a", true);\n}\nconst check = () => {};\n`;
    expect(hazards(broken).map((h) => h.name)).toEqual(["check"]);
  });

  it("does not mistake a method call for a reference", () => {
    const fine = `const flag = (n) => process.argv.find((a) => a === n);\nconst find = (k) => k;\n`;
    expect(hazards(fine)).toEqual([]);
  });

  it("does not mistake a name inside a regex literal for a reference", () => {
    const fine = `const HOST = /(^|\\.)(banan\\.to|r2\\.dev)$/i;\nconst r2 = make();\n`;
    expect(hazards(fine)).toEqual([]);
  });

  it("does not mistake a function parameter for a reference", () => {
    const fine = `function parse(raw) {\n  return raw;\n}\nconst raw = read();\n`;
    expect(hazards(fine)).toEqual([]);
  });

  it("does not mistake prose in a comment for a reference", () => {
    const fine = `/* The step helper times each query. */\nconst step = 1;\n`;
    expect(hazards(fine)).toEqual([]);
  });

  /*
    A body that runs later is the whole reason this is not `no-use-before-define`:
    that rule reports twelve of these across four scripts, every one correct.
  */
  it("allows a helper defined above the const it will use when called", () => {
    const fine = `const run = () => later();\nconst later = () => 1;\nrun();\n`;
    expect(hazards(fine)).toEqual([]);
  });

  /* Both of these were false alarms from the first tree-walking version. */
  it("does not mistake an inner block's own name for the module's", () => {
    const fine = `for (const x of [1]) {\n  const versions = x;\n  use(versions);\n}\nconst versions = 2;\n`;
    expect(hazards(fine)).toEqual([]);
  });

  it("does not mistake an import alias for a reference", () => {
    const fine = `import { present as presentCell } from "./m.mjs";\nconst present = presentCell;\n`;
    expect(hazards(fine)).toEqual([]);
  });

  it.each([...files, ...libFiles])("%s", (file) => {
    const found = hazards(readFileSync(path.join(dir, file), "utf8"));
    expect(
      found.map((h) => `${h.name}: used line ${h.useLine}, defined line ${h.defLine}`),
    ).toEqual([]);
  });
});
