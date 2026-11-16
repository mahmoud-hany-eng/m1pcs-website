import assert from "node:assert/strict";
import test from "node:test";
import { lintSchema, validate } from "../lib/json-schema.mjs";

const strictObject = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

test("type checks distinguish integers, numbers, strings, null and arrays", () => {
  assert.equal(validate({ type: "integer" }, 3).valid, true);
  assert.equal(validate({ type: "integer" }, 3.5).valid, false);
  assert.equal(validate({ type: "number" }, 3).valid, true);
  assert.equal(validate({ type: "string" }, 3).valid, false);
  assert.equal(validate({ type: ["string", "null"] }, null).valid, true);
  assert.equal(validate({ type: "array" }, {}).valid, false);
  assert.match(validate({ type: "string" }, 3).errors[0], /expected string, got integer/);
});

test("required properties and unexpected properties are reported with readable messages", () => {
  const schema = strictObject({ a: { type: "string" }, b: { type: "integer" } });
  const result = validate(schema, { a: "x", c: 1 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('missing required property "b"')));
  assert.ok(result.errors.some((e) => e.includes('unexpected property "c"')));
});

test("errors carry the JSON pointer of the offending value", () => {
  const schema = strictObject({ list: { type: "array", items: strictObject({ n: { type: "integer" } }) } });
  const result = validate(schema, { list: [{ n: 1 }, { n: "two" }] });
  assert.ok(result.errors[0].startsWith("/list/1/n:"), result.errors[0]);
});

test("enum, const and pattern", () => {
  assert.equal(validate({ enum: ["A", "B"] }, "C").valid, false);
  assert.equal(validate({ enum: [null, "x"] }, null).valid, true);
  assert.equal(validate({ const: true }, false).valid, false);
  assert.equal(validate({ const: "1" }, "1").valid, true);
  const r = validate({ type: "string", pattern: "^[A-Z]{3}-[0-9]{4}$" }, "ops-0001");
  assert.match(r.errors[0], /does not match pattern/);
});

test("string, number and array bounds", () => {
  assert.equal(validate({ type: "string", minLength: 3 }, "ab").valid, false);
  assert.equal(validate({ type: "string", maxLength: 3 }, "abcd").valid, false);
  assert.equal(validate({ type: "number", minimum: 0, maximum: 1 }, 1.5).valid, false);
  assert.equal(validate({ type: "number", minimum: 0, maximum: 1 }, 0.5).valid, true);
  assert.equal(validate({ type: "array", minItems: 1 }, []).valid, false);
  assert.equal(validate({ type: "array", maxItems: 1 }, [1, 2]).valid, false);
  assert.equal(validate({ type: "array", uniqueItems: true }, [1, 1]).valid, false);
});

test("nullable values only apply constraints to the non-null type", () => {
  const schema = { type: ["string", "null"], pattern: "^HD-[0-9]{4}$" };
  assert.equal(validate(schema, null).valid, true);
  assert.equal(validate(schema, "HD-0001").valid, true);
  assert.equal(validate(schema, "HD-1").valid, false);
});

test("local $ref resolves, and a missing definition is an error", () => {
  const root = { $defs: { id: { type: "string", pattern: "^X" } }, type: "object", properties: { a: { $ref: "#/$defs/id" } }, required: ["a"], additionalProperties: false };
  assert.equal(validate(root, { a: "Xyz" }).valid, true);
  assert.equal(validate(root, { a: "Y" }).valid, false);
  assert.match(validate({ $ref: "#/$defs/nope" }, 1).errors[0], /unresolved/);
});

test("anyOf accepts either shape and explains the closest failure", () => {
  const schema = { anyOf: [strictObject({ n: { type: "integer" } }), { type: "null" }] };
  assert.equal(validate(schema, null).valid, true);
  assert.equal(validate(schema, { n: 1 }).valid, true);
  const bad = validate(schema, { n: "x" });
  assert.equal(bad.valid, false);
  assert.match(bad.errors[0], /does not match any allowed shape/);
  assert.match(bad.errors[0], /expected integer/);
});

test("lintSchema rejects keywords the validator cannot enforce", () => {
  const problems = lintSchema({ type: "string", format: "date-time" }, { strict: false });
  assert.ok(problems.some((p) => p.includes('unsupported keyword "format"')));
  assert.ok(lintSchema({ type: "string", oneOf: [] }, { strict: false }).some((p) => p.includes('"oneOf"')));
});

test("lintSchema enforces the strict-object convention", () => {
  const loose = { type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a"] };
  const problems = lintSchema(loose);
  assert.ok(problems.some((p) => p.includes("additionalProperties to false")));
  assert.ok(problems.some((p) => p.includes("not required: b")));
  assert.ok(lintSchema({ type: "object" }).some((p) => p.includes("free-form")));
  assert.deepEqual(lintSchema(strictObject({ a: { type: "string" } })), []);
});

test("lintSchema flags bad references, bad patterns and unknown types", () => {
  assert.ok(lintSchema({ $ref: "#/$defs/missing" }, { strict: false }).some((p) => p.includes("does not resolve")));
  assert.ok(lintSchema({ type: "string", pattern: "([" }, { strict: false }).some((p) => p.includes("does not compile")));
  assert.ok(lintSchema({ type: "text" }, { strict: false }).some((p) => p.includes("unknown type")));
});
