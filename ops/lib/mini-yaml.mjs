// A deliberately small YAML reader for reviewing GitHub Actions workflow files. Zero dependencies.
//
// It is NOT a general YAML parser. It reads the plain block style that workflows are normally written in and REJECTS
// every construct it cannot interpret unambiguously, so that the workflow-safety checker can never be misled by a
// document that another YAML reader (GitHub's own) would interpret differently. Rejected, with a readable message:
//   tabs used for indentation, document markers and directives (--- ... %), anchors, aliases and tags (& * !),
//   merge keys (<<), flow mappings ({...}), nested or multi-line flow sequences, complex keys (?),
//   duplicate keys, multi-line plain or quoted scalars, sequences written at the same indent as their key,
//   and a colon followed by a space inside a plain scalar.
// Supported: comments, block mappings, block sequences, plain / 'single' / "double" quoted scalars,
// one-line flow sequences of simple scalars (for example [a, "b"]), and block scalars (| |- > >-).
//
// Result nodes:
//   { type: "map", entries: [{ key, line, value }], line }
//   { type: "seq", items: [node], line }
//   { type: "scalar", value: string, quoted: boolean, block: boolean, empty: boolean, comment: string|null, line }
// Scalars are never converted: "true", "22" and "null" stay strings, and the checker compares them as text.

export class YamlError extends Error {
  constructor(message, line) {
    super(message);
    this.name = "YamlError";
    this.line = line;
  }
}

const MAX_LINES = 5000;
const MAX_DEPTH = 24;

const fail = (line, message) => {
  throw new YamlError(message, line);
};

function prepare(text) {
  if (typeof text !== "string") fail(0, "the workflow text must be a string");
  if (text.includes("\0")) fail(0, "the file contains a NUL character");
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const raw = body.split("\n");
  if (raw.length > MAX_LINES) fail(0, `the file has more than ${MAX_LINES} lines`);
  return raw.map((line, idx) => {
    const no = idx + 1;
    const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (clean.includes("\r")) fail(no, "a lone carriage return is not supported");
    const lead = /^[ \t]*/.exec(clean)[0];
    if (lead.includes("\t")) fail(no, "tabs are not allowed for indentation");
    const trimmed = clean.slice(lead.length);
    if (lead.length === 0 && (/^(---|\.\.\.)(\s|$)/.test(clean) || clean.startsWith("%"))) {
      fail(no, "document markers, multiple documents and directives are not supported");
    }
    return { no, indent: lead.length, text: trimmed };
  });
}

const isBlank = (rec) => rec.text === "" || rec.text.startsWith("#");
const isSeqItem = (text) => text === "-" || text.startsWith("- ");

/** Remove a trailing " #comment" from text that is NOT a quoted scalar (quotes inside a plain scalar are ordinary characters). */
function splitPlainComment(text) {
  const m = /(^|\s)#/.exec(text);
  if (!m) return { body: text.trimEnd(), comment: null };
  const at = m.index + m[1].length;
  return { body: text.slice(0, at).trimEnd(), comment: text.slice(at + 1).trim() };
}

/** Parse a quoted scalar at the start of `text`; returns { value, rest } where rest is what follows the closing quote. */
function readQuoted(text, line) {
  const q = text[0];
  let out = "";
  let i = 1;
  for (; i < text.length; i += 1) {
    const c = text[i];
    if (q === "'") {
      if (c === "'") {
        if (text[i + 1] === "'") {
          out += "'";
          i += 1;
        } else return { value: out, rest: text.slice(i + 1) };
      } else out += c;
    } else if (c === "\\") {
      const e = text[i + 1];
      const map = { '"': '"', "\\": "\\", "/": "/", n: "\n", t: "\t" };
      if (!(e in map)) fail(line, `the escape sequence \\${e ?? ""} in a double-quoted string is not supported`);
      out += map[e];
      i += 1;
    } else if (c === '"') return { value: out, rest: text.slice(i + 1) };
    else out += c;
  }
  return fail(line, "a quoted string is not closed on the same line (multi-line strings are not supported)");
}

function scalar(value, line, extra = {}) {
  return { type: "scalar", value, quoted: false, block: false, empty: false, comment: null, line, ...extra };
}

function afterQuote(rest, line) {
  if (rest.trim() === "") return null;
  if (/^\s+#/.test(rest)) return rest.trim().slice(1).trim();
  return fail(line, `unexpected text after a quoted string: ${JSON.stringify(rest.trim().slice(0, 40))}`);
}

function plainScalar(body, line, comment) {
  if (body === "") return scalar("", line, { empty: true, comment });
  const first = body[0];
  if ("&*!".includes(first)) fail(line, "anchors, aliases and tags are not supported");
  if ("@`%".includes(first)) fail(line, `a plain scalar cannot start with "${first}"; quote it`);
  if (first === "?" && (body.length === 1 || body[1] === " ")) fail(line, "complex keys are not supported");
  if (first === "{") fail(line, "flow mappings are not supported; write a block mapping");
  if (/:(\s|$)/.test(body)) fail(line, 'a plain scalar cannot contain ": " (quote the text, or it is a nested mapping that must be written on its own lines)');
  return scalar(body, line, { comment });
}

/** Parse the inline text of a scalar or one-line flow sequence (the part after "key:" or "- "). */
function parseInline(text, line) {
  const t = text.trimStart();
  if (t === "" || t.startsWith("#")) return scalar("", line, { empty: true, comment: t.startsWith("#") ? t.slice(1).trim() : null });
  const first = t[0];
  if (first === '"' || first === "'") {
    const { value, rest } = readQuoted(t, line);
    return scalar(value, line, { quoted: true, comment: afterQuote(rest, line) });
  }
  if (first === "[") {
    const { body, comment } = splitPlainComment(t);
    if (!body.endsWith("]")) fail(line, "a flow sequence must be closed on the same line");
    const inner = body.slice(1, -1).trim();
    const items = [];
    if (inner !== "") {
      let rest = inner;
      for (;;) {
        rest = rest.trimStart();
        let item;
        if (rest[0] === '"' || rest[0] === "'") {
          const r = readQuoted(rest, line);
          item = scalar(r.value, line, { quoted: true });
          rest = r.rest.trimStart();
        } else {
          const end = rest.search(/,/);
          const piece = (end === -1 ? rest : rest.slice(0, end)).trim();
          if (/[[\]{}]/.test(piece)) fail(line, "nested flow collections are not supported");
          item = plainScalar(piece, line, null);
          rest = end === -1 ? "" : rest.slice(end);
        }
        items.push(item);
        if (rest === "") break;
        if (rest[0] !== ",") fail(line, "expected a comma in a flow sequence");
        rest = rest.slice(1);
        if (rest.trim() === "") fail(line, "a trailing comma in a flow sequence is not supported");
      }
    }
    return { type: "seq", items, line, flow: true, comment };
  }
  const { body, comment } = splitPlainComment(t);
  return plainScalar(body, line, comment);
}

/** Split "key: value" into { key, rest }, or null when the text is not a mapping entry. */
function splitEntry(text, line) {
  if (text[0] === '"' || text[0] === "'") {
    const { value, rest } = readQuoted(text, line);
    const m = /^\s*:(\s|$)/.exec(rest);
    if (!m) return null;
    return { key: value, rest: rest.slice(rest.indexOf(":") + 1) };
  }
  const m = /^(.*?):(\s|$)/.exec(text);
  if (!m) return null;
  const key = m[1].trimEnd();
  if (key === "<<") fail(line, "merge keys are not supported");
  if (key === "" || /^[&*!?@`%{[|>]/.test(key)) fail(line, `unsupported mapping key ${JSON.stringify(key.slice(0, 20))}`);
  return { key, rest: text.slice(m[1].length + 1) };
}

export function parseYaml(text) {
  const lines = prepare(text);
  let i = 0;

  const nextSig = (from) => {
    for (let j = from; j < lines.length; j += 1) if (!isBlank(lines[j])) return j;
    return -1;
  };

  function parseBlockScalar(header, keyIndent, line) {
    const m = /^([|>])([+-]?)(\s+#.*)?$/.exec(header);
    if (!m) fail(line, "unsupported block scalar header (indentation indicators are not supported)");
    const [, style, chomp] = m;
    const body = [];
    let blockIndent = null;
    while (i < lines.length) {
      const rec = lines[i];
      if (rec.text === "") {
        body.push("");
        i += 1;
        continue;
      }
      if (rec.indent <= keyIndent) break;
      if (blockIndent === null) blockIndent = rec.indent;
      if (rec.indent < blockIndent) fail(rec.no, "inconsistent indentation inside a block scalar");
      body.push(" ".repeat(rec.indent - blockIndent) + rec.text);
      i += 1;
    }
    while (body.length && body[body.length - 1] === "" && chomp !== "+") body.pop();
    let value = style === "|" ? body.join("\n") : body.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ");
    if (chomp !== "-" && body.length) value += "\n";
    return scalar(value, line, { block: true });
  }

  function parseValue(rest, rec, keyIndent, depth) {
    const t = rest.trimStart();
    const bare = t.replace(/\s+#.*$/, "");
    if (bare === "" || t.startsWith("#")) {
      const j = nextSig(i);
      if (j !== -1 && lines[j].indent > keyIndent) return parseNode(lines[j].indent, depth + 1);
      if (j !== -1 && lines[j].indent === keyIndent && isSeqItem(lines[j].text)) {
        fail(lines[j].no, "sequence items must be indented under their key");
      }
      return scalar("", rec.no, { empty: true, comment: t.startsWith("#") ? t.slice(1).trim() : null });
    }
    if (t[0] === "|" || t[0] === ">") return parseBlockScalar(t, keyIndent, rec.no);
    return parseInline(t, rec.no);
  }

  function parseMap(indent, depth) {
    const map = { type: "map", entries: [], line: lines[i].no };
    const seen = new Set();
    for (;;) {
      const j = nextSig(i);
      if (j === -1) {
        i = lines.length;
        break;
      }
      const rec = lines[j];
      if (rec.indent < indent) {
        i = j;
        break;
      }
      if (rec.indent > indent) fail(rec.no, "unexpected indentation (multi-line plain scalars are not supported)");
      if (isSeqItem(rec.text)) fail(rec.no, 'a sequence item "- " appears where a mapping key was expected');
      if (/^\?(\s|$)/.test(rec.text)) fail(rec.no, "complex keys are not supported");
      const kv = splitEntry(rec.text, rec.no);
      if (!kv) fail(rec.no, `expected "key: value" but found ${JSON.stringify(rec.text.slice(0, 40))}`);
      if (seen.has(kv.key)) fail(rec.no, `duplicate key "${kv.key}"`);
      seen.add(kv.key);
      i = j + 1;
      const value = parseValue(kv.rest, rec, indent, depth);
      map.entries.push({ key: kv.key, line: rec.no, value });
    }
    return map;
  }

  function parseSeq(indent, depth) {
    const seq = { type: "seq", items: [], line: lines[i].no, flow: false, comment: null };
    for (;;) {
      const j = nextSig(i);
      if (j === -1) {
        i = lines.length;
        break;
      }
      const rec = lines[j];
      if (rec.indent < indent) {
        i = j;
        break;
      }
      if (rec.indent > indent) fail(rec.no, "unexpected indentation inside a sequence");
      if (!isSeqItem(rec.text)) fail(rec.no, 'expected a sequence item starting with "- "');
      const rest = rec.text.slice(1);
      const content = rest.trimStart();
      if (content === "" || content.startsWith("#")) {
        i = j + 1;
        const k = nextSig(i);
        if (k !== -1 && lines[k].indent > indent) seq.items.push(parseNode(lines[k].indent, depth + 1));
        else seq.items.push(scalar("", rec.no, { empty: true }));
        continue;
      }
      if (content === "-" || content.startsWith("- ")) fail(rec.no, "nested sequences on one line are not supported");
      const contentIndent = rec.indent + 1 + (rest.length - content.length);
      if (splitEntry(content, rec.no) !== null) {
        lines[j] = { no: rec.no, indent: contentIndent, text: content };
        i = j;
        seq.items.push(parseMap(contentIndent, depth + 1));
      } else {
        i = j + 1;
        seq.items.push(parseInline(content, rec.no));
      }
    }
    return seq;
  }

  function parseNode(indent, depth) {
    if (depth > MAX_DEPTH) fail(lines[i] ? lines[i].no : 0, `nesting deeper than ${MAX_DEPTH} levels is not supported`);
    const j = nextSig(i);
    if (j === -1) return scalar("", 0, { empty: true });
    i = j;
    if (lines[j].indent !== indent) fail(lines[j].no, "unexpected indentation");
    return isSeqItem(lines[j].text) ? parseSeq(indent, depth) : parseMap(indent, depth);
  }

  const first = nextSig(0);
  if (first === -1) return { type: "map", entries: [], line: 1 };
  if (lines[first].indent !== 0) fail(lines[first].no, "the document must start at column 1");
  i = first;
  const root = parseNode(0, 0);
  const trailing = nextSig(i);
  if (trailing !== -1) fail(lines[trailing].no, "unexpected content after the end of the document");
  return root;
}

/* ----------------------------------------------------------------- helpers */

export const isMap = (n) => n && n.type === "map";
export const isSeq = (n) => n && n.type === "seq";
export const isScalar = (n) => n && n.type === "scalar";

/** The entry of a map with this key, or undefined. */
export function entry(map, key) {
  return isMap(map) ? map.entries.find((e) => e.key === key) : undefined;
}

export function get(map, key) {
  const e = entry(map, key);
  return e ? e.value : undefined;
}

/** The text of a non-empty single-line scalar, or null for anything else. */
export function text(node) {
  return isScalar(node) && !node.block && !node.empty ? node.value : null;
}

/** Plain JavaScript view of a node (for tests and debugging). */
export function toJs(node) {
  if (isMap(node)) return Object.fromEntries(node.entries.map((e) => [e.key, toJs(e.value)]));
  if (isSeq(node)) return node.items.map(toJs);
  return node.empty ? null : node.value;
}
