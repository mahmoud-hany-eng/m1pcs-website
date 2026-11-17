// Minimal JSON Schema validator (a strict subset of draft 2020-12). Zero dependencies.
//
// Why a subset: the project-memory contracts must be enforceable offline with only Node built-ins.
// Rather than silently ignoring keywords it cannot enforce, lintSchema() REJECTS any keyword outside the
// supported set, so a schema can never look stricter than it is.

export const SUPPORTED_KEYWORDS = new Set([
  "$schema", "$id", "$defs", "$ref", "title", "description",
  "type", "enum", "const",
  "pattern", "minLength", "maxLength",
  "minimum", "maximum",
  "required", "properties", "additionalProperties",
  "items", "minItems", "maxItems", "uniqueItems",
  "anyOf",
]);

const TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);
const REF_RE = /^#\/\$defs\/([A-Za-z0-9_]+)$/;

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value; // string | boolean | object
}

function typeMatches(expected, value) {
  const actual = typeOf(value);
  return expected === actual || (expected === "number" && actual === "integer");
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function show(value) {
  const text = JSON.stringify(value);
  if (text === undefined) return String(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function at(pointer) {
  return pointer === "" ? "(root)" : pointer;
}

/** Resolve a local $ref. Returns the schema or null. */
function resolveRef(root, ref) {
  const m = REF_RE.exec(ref);
  if (!m) return null;
  const defs = root && root.$defs;
  return defs && Object.prototype.hasOwnProperty.call(defs, m[1]) ? defs[m[1]] : null;
}

/**
 * Check that a schema only uses supported keywords and, when strict, follows the strict-object convention
 * (every property required, additionalProperties false), which keeps a contract easy to enforce with any structured-output facility.
 * Returns a list of human-readable problems (empty when fine).
 */
export function lintSchema(root, { strict = true } = {}) {
  const problems = [];
  const seen = new Set();

  function walk(schema, pointer) {
    if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
      problems.push(`${at(pointer)}: a schema must be an object`);
      return;
    }
    if (seen.has(schema)) return;
    seen.add(schema);

    for (const key of Object.keys(schema)) {
      if (!SUPPORTED_KEYWORDS.has(key)) {
        problems.push(`${at(pointer)}: unsupported keyword "${key}" (the offline validator would ignore it, so it must not be used)`);
      }
    }

    if ("type" in schema) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      for (const t of types) {
        if (!TYPES.has(t)) problems.push(`${at(pointer)}: unknown type ${show(t)}`);
      }
    }
    if ("$ref" in schema && resolveRef(root, schema.$ref) === null) {
      problems.push(`${at(pointer)}: $ref ${show(schema.$ref)} does not resolve to a local #/$defs/<name>`);
    }
    if ("pattern" in schema) {
      try {
        new RegExp(schema.pattern, "u");
      } catch (err) {
        problems.push(`${at(pointer)}: pattern does not compile (${err.message})`);
      }
    }
    for (const key of ["minLength", "maxLength", "minItems", "maxItems"]) {
      if (key in schema && !(Number.isInteger(schema[key]) && schema[key] >= 0)) {
        problems.push(`${at(pointer)}: ${key} must be a non-negative integer`);
      }
    }
    if ("required" in schema && !(Array.isArray(schema.required) && schema.required.every((r) => typeof r === "string"))) {
      problems.push(`${at(pointer)}: required must be an array of strings`);
    }
    if ("enum" in schema && !Array.isArray(schema.enum)) {
      problems.push(`${at(pointer)}: enum must be an array`);
    }

    if (strict && schema.properties !== undefined) {
      const keys = Object.keys(schema.properties);
      if (schema.additionalProperties !== false) {
        problems.push(`${at(pointer)}: strict object schemas must set additionalProperties to false`);
      }
      const required = Array.isArray(schema.required) ? schema.required : [];
      const missing = keys.filter((k) => !required.includes(k));
      const unknown = required.filter((k) => !keys.includes(k));
      if (missing.length) problems.push(`${at(pointer)}: strict object schemas must require every property; not required: ${missing.join(", ")}`);
      if (unknown.length) problems.push(`${at(pointer)}: required lists properties that are not declared: ${unknown.join(", ")}`);
    }
    if (strict && schema.type === "object" && schema.properties === undefined) {
      problems.push(`${at(pointer)}: strict schemas do not allow free-form objects (declare properties)`);
    }

    if (schema.properties && typeof schema.properties === "object") {
      for (const [k, v] of Object.entries(schema.properties)) walk(v, `${pointer}/properties/${k}`);
    }
    if (schema.$defs && typeof schema.$defs === "object") {
      for (const [k, v] of Object.entries(schema.$defs)) walk(v, `${pointer}/$defs/${k}`);
    }
    if (schema.items !== undefined) walk(schema.items, `${pointer}/items`);
    if (Array.isArray(schema.anyOf)) schema.anyOf.forEach((s, i) => walk(s, `${pointer}/anyOf/${i}`));
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      walk(schema.additionalProperties, `${pointer}/additionalProperties`);
    }
  }

  walk(root, "");
  return problems;
}

/**
 * Validate data against a schema. Returns { valid, errors } where every error is
 * "<json pointer>: <readable message>".
 */
export function validate(root, data) {
  const errors = [];

  function check(schema, value, pointer, depth) {
    if (depth > 64) {
      errors.push(`${at(pointer)}: schema nesting too deep`);
      return;
    }
    if (schema.$ref !== undefined) {
      const target = resolveRef(root, schema.$ref);
      if (target === null) {
        errors.push(`${at(pointer)}: unresolved $ref ${show(schema.$ref)}`);
        return;
      }
      check(target, value, pointer, depth + 1);
      return;
    }

    if (schema.anyOf) {
      let best = null;
      for (const sub of schema.anyOf) {
        const before = errors.length;
        check(sub, value, pointer, depth + 1);
        const produced = errors.splice(before);
        if (produced.length === 0) return; // one branch matches
        if (best === null || produced.length < best.length) best = produced;
      }
      errors.push(`${at(pointer)}: does not match any allowed shape; closest match failed with: ${best.join("; ")}`);
      return;
    }

    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((t) => typeMatches(t, value))) {
        errors.push(`${at(pointer)}: expected ${types.join(" or ")}, got ${typeOf(value)}`);
        return;
      }
    }
    if (schema.const !== undefined && !deepEqual(schema.const, value)) {
      errors.push(`${at(pointer)}: must be ${show(schema.const)}, got ${show(value)}`);
    }
    if (schema.enum !== undefined && !schema.enum.some((e) => deepEqual(e, value))) {
      errors.push(`${at(pointer)}: ${show(value)} is not one of ${show(schema.enum)}`);
    }

    if (typeof value === "string") {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${at(pointer)}: shorter than ${schema.minLength} characters (got ${value.length})`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${at(pointer)}: longer than ${schema.maxLength} characters (got ${value.length})`);
      }
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) {
        errors.push(`${at(pointer)}: ${show(value)} does not match pattern ${schema.pattern}`);
      }
    }

    if (typeof value === "number") {
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at(pointer)}: ${value} is below the minimum ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at(pointer)}: ${value} is above the maximum ${schema.maximum}`);
    }

    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at(pointer)}: needs at least ${schema.minItems} item(s), has ${value.length}`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at(pointer)}: allows at most ${schema.maxItems} item(s), has ${value.length}`);
      if (schema.uniqueItems) {
        const seen = new Set();
        value.forEach((item, i) => {
          const key = JSON.stringify(item);
          if (seen.has(key)) errors.push(`${at(`${pointer}/${i}`)}: duplicate item ${show(item)}`);
          seen.add(key);
        });
      }
      if (schema.items !== undefined) value.forEach((item, i) => check(schema.items, item, `${pointer}/${i}`, depth + 1));
    }

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const props = schema.properties || {};
      for (const name of schema.required || []) {
        if (!Object.prototype.hasOwnProperty.call(value, name)) errors.push(`${at(pointer)}: missing required property "${name}"`);
      }
      for (const [name, sub] of Object.entries(props)) {
        if (Object.prototype.hasOwnProperty.call(value, name)) check(sub, value[name], `${pointer}/${name}`, depth + 1);
      }
      for (const name of Object.keys(value)) {
        if (Object.prototype.hasOwnProperty.call(props, name)) continue;
        if (schema.additionalProperties === false) {
          errors.push(`${at(pointer)}: unexpected property "${name}" (additionalProperties is false)`);
        } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
          check(schema.additionalProperties, value[name], `${pointer}/${name}`, depth + 1);
        }
      }
    }
  }

  check(root, data, "", 0);
  return { valid: errors.length === 0, errors };
}
