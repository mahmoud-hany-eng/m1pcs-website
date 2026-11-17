// The restricted YAML reader must read ordinary workflow files exactly, and refuse everything it cannot read unambiguously.
import assert from "node:assert/strict";
import test from "node:test";
import { YamlError, entry, get, parseYaml, text, toJs } from "../lib/mini-yaml.mjs";

const parse = (s) => toJs(parseYaml(s));
const rejects = (s, fragment) => {
  assert.throws(() => parseYaml(s), (err) => {
    assert.ok(err instanceof YamlError, `expected a YamlError, got ${err}`);
    assert.ok(err.message.includes(fragment), `expected "${fragment}" in "${err.message}"`);
    assert.ok(Number.isInteger(err.line));
    return true;
  });
};

test("reads block mappings, block sequences and nesting", () => {
  assert.deepEqual(parse("a: 1\nb:\n  c: x\n  d:\n    - p\n    - q\n"), { a: "1", b: { c: "x", d: ["p", "q"] } });
});

test("reads sequences of mappings, with the first key on the dash line", () => {
  const doc = parse("steps:\n  - name: one\n    run: a b\n  - uses: x/y@abc\n    with:\n      k: v\n");
  assert.deepEqual(doc, { steps: [{ name: "one", run: "a b" }, { uses: "x/y@abc", with: { k: "v" } }] });
});

test("scalars are never converted: true, 22 and null stay text", () => {
  assert.deepEqual(parse("a: true\nb: 22\nc: null\nd: no\n"), { a: "true", b: "22", c: "null", d: "no" });
});

test("quoted scalars: single, double, escapes and quoted keys", () => {
  assert.deepEqual(parse("a: 'it''s'\nb: \"say \\\"hi\\\"\"\n\"c d\": e\n"), { a: "it's", b: 'say "hi"', "c d": "e" });
  const node = parseYaml("a: 'x'\nb: y\n");
  assert.equal(entry(node, "a").value.quoted, true);
  assert.equal(entry(node, "b").value.quoted, false);
});

test("comments are removed, and the trailing comment of a scalar is kept", () => {
  const node = parseYaml("# header\na: value # v7.0.1\nb: 'q' # about q\nc:   # nothing here\n  d: 1\n");
  assert.equal(get(node, "a").value, "value");
  assert.equal(get(node, "a").comment, "v7.0.1");
  assert.equal(get(node, "b").comment, "about q");
  assert.deepEqual(toJs(node).c, { d: "1" });
});

test("a # without a preceding space is part of the text, and quotes inside a plain scalar are ordinary characters", () => {
  assert.deepEqual(parse('a: x#y\nrun: test -z "${KEY:-}"\n'), { a: "x#y", run: 'test -z "${KEY:-}"' });
});

test("an expression such as ${{ github.ref }} is plain text to the reader", () => {
  assert.equal(parse("group: ci-${{ github.workflow }}-${{ github.ref }}\n").group, "ci-${{ github.workflow }}-${{ github.ref }}");
});

test("one-line flow sequences of simple scalars are read", () => {
  assert.deepEqual(parse('b: ["claude/**", main, \'x\']\ne: []\n'), { b: ["claude/**", "main", "x"], e: [] });
});

test("block scalars keep their lines", () => {
  const v = parse("run: |\n  echo a\n  echo b\nnext: 1\n");
  assert.equal(v.run, "echo a\necho b\n");
  assert.equal(v.next, "1");
  assert.equal(parse("run: |-\n  echo a\n").run, "echo a");
  assert.equal(entry(parseYaml("run: |\n  x\n"), "run").value.block, true);
});

test("empty values and empty documents", () => {
  assert.deepEqual(parse("a:\nb: 1\n"), { a: null, b: "1" });
  assert.deepEqual(parse(""), {});
  assert.deepEqual(parse("# only a comment\n"), {});
});

test("CRLF line endings and a byte-order mark are accepted", () => {
  assert.deepEqual(parse("\ufeffa: 1\r\nb:\r\n  c: 2\r\n"), { a: "1", b: { c: "2" } });
});

test("helpers: entry, get and text", () => {
  const node = parseYaml("a: x\nb: |\n  y\nc:\n");
  assert.equal(text(get(node, "a")), "x");
  assert.equal(text(get(node, "b")), null);
  assert.equal(text(get(node, "c")), null);
  assert.equal(get(node, "missing"), undefined);
  assert.equal(entry(node, "missing"), undefined);
});

test("constructs that another YAML reader could interpret differently are rejected", async (t) => {
  await t.test("tabs for indentation", () => rejects("a:\n\tb: 1\n", "tabs are not allowed"));
  await t.test("anchors", () => rejects("a: &x 1\n", "anchors, aliases and tags"));
  await t.test("aliases", () => rejects("a: *x\n", "anchors, aliases and tags"));
  await t.test("tags", () => rejects("a: !!str 1\n", "anchors, aliases and tags"));
  await t.test("merge keys", () => rejects("<<: *x\n", "merge keys"));
  await t.test("flow mappings", () => rejects("a: {b: 1}\n", "flow mappings"));
  await t.test("nested flow sequences", () => rejects("a: [[1], 2]\n", "nested flow"));
  await t.test("a flow sequence that is not closed on the line", () => rejects("a: [1,\n  2]\n", "closed on the same line"));
  await t.test("a trailing comma in a flow sequence", () => rejects("a: [1, ]\n", "trailing comma"));
  await t.test("duplicate keys", () => rejects("a: 1\nb: 2\na: 3\n", 'duplicate key "a"'));
  await t.test("a document marker", () => rejects("a: 1\n---\nb: 2\n", "document markers"));
  await t.test("a directive", () => rejects("%YAML 1.2\na: 1\n", "document markers"));
  await t.test("a multi-line plain scalar", () => rejects("a: one\n  two\n", "unexpected indentation"));
  await t.test("a quote that is not closed", () => rejects('a: "oops\n', "not closed"));
  await t.test("text after a closing quote", () => rejects("a: 'x' y\n", "after a quoted string"));
  await t.test("an escape that is not supported", () => rejects('a: "\\x41"\n', "escape sequence"));
  await t.test("a colon and space inside a plain scalar", () => rejects("a: b: c\n", 'cannot contain ": "'));
  await t.test("a sequence at the same indent as its key", () => rejects("a:\n- x\n- y\n", "must be indented under their key"));
  await t.test("a sequence item where a key is expected", () => rejects("a: 1\n- x\n", "sequence item"));
  await t.test("a line that is not key: value", () => rejects("a: 1\njust text\n", 'expected "key: value"'));
  await t.test("a document that does not start at column 1", () => rejects("  a: 1\n", "column 1"));
  await t.test("complex keys", () => rejects("? a\n: b\n", "complex keys"));
  await t.test("a plain scalar starting with @", () => rejects("a: @x\n", "cannot start with"));
  await t.test("block scalar indentation indicators", () => rejects("a: |2\n  x\n", "block scalar header"));
  await t.test("nested sequences on one line", () => rejects("a:\n  - - x\n", "nested sequences"));
  await t.test("a NUL character", () => rejects("a: 1\0\n", "NUL"));
  await t.test("a lone carriage return", () => rejects("a: 1\rb: 2\n", "carriage return"));
  await t.test("nesting that is too deep", () => {
    const deep = Array.from({ length: 40 }, (_, i) => `${"  ".repeat(i)}k${i}:`).join("\n");
    rejects(`${deep}\n`, "nesting deeper");
  });
});

test("errors carry the line number", () => {
  try {
    parseYaml("a: 1\nb: 2\nc: &x 3\n");
    assert.fail("expected an error");
  } catch (err) {
    assert.ok(err instanceof YamlError);
    assert.equal(err.line, 3);
  }
});
