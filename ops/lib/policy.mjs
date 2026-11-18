// Deterministic policy logic. Zero dependencies.
//
// This is the trusted code path that turns changed file paths into a risk class and restriction level.
// Risk classes are NEVER taken from a model's or worker's self-classification: those values are advisory
// and can only raise what this module computes (see policy.classification in policy.json).

export const CLASS_ORDER = { A: 0, B: 1, C: 2 };
export const RESTRICTION_ORDER = { none: 0, protected: 1, control_plane: 2, immutable: 3 };

export function maxClass(...classes) {
  return classes.filter(Boolean).reduce((a, b) => (CLASS_ORDER[b] > CLASS_ORDER[a] ? b : a), "A");
}

export function maxRestriction(...restrictions) {
  return restrictions.filter(Boolean).reduce((a, b) => (RESTRICTION_ORDER[b] > RESTRICTION_ORDER[a] ? b : a), "none");
}

export function normalizePath(p) {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "");
}

const regexCache = new Map();

/** gitignore-flavoured glob: ** crosses directories (and may match zero), * and ? stay inside one path segment. */
export function globToRegExp(glob) {
  if (regexCache.has(glob)) return regexCache.get(glob);
  let out = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?"; // "**/" = zero or more directories
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\\-]/g, "\\$&");
    }
  }
  out += "$";
  const re = new RegExp(out);
  regexCache.set(glob, re);
  return re;
}

export function matchesGlob(glob, path) {
  return globToRegExp(glob).test(normalizePath(path));
}

export function matchesAny(globs, path) {
  return globs.some((g) => matchesGlob(g, path));
}

/** The literal leading part of a glob: every path the glob can match starts with this string. */
export function staticPrefix(glob) {
  const i = glob.search(/[*?]/);
  return i === -1 ? glob : glob.slice(0, i);
}

function ruleApplies(rule, path) {
  return matchesAny(rule.patterns, path) && !matchesAny(rule.exclude || [], path);
}

/** Classify one concrete path with every rule that matches it. */
export function classifyPath(path, policy) {
  const p = normalizePath(path);
  const matched = policy.path_rules.filter((r) => ruleApplies(r, p));
  const categories = matched.length ? [...new Set(matched.map((r) => r.category))] : [policy.classification.unmatched_path_category];
  const cls = maxClass(...categories.map((c) => policy.risk_categories[c].minimum_class));
  const restriction = maxRestriction(...matched.map((r) => r.restriction));
  return { path: p, rules: matched.map((r) => r.id), categories, class: cls, restriction };
}

/** Classify a set of concrete changed paths. The result is authoritative; declared classes can only raise it. */
export function classifyPaths(paths, policy) {
  const hits = paths.map((p) => classifyPath(p, policy));
  const categories = [...new Set(hits.flatMap((h) => h.categories))];
  return {
    class: maxClass(...hits.map((h) => h.class)),
    restriction: maxRestriction(...hits.map((h) => h.restriction)),
    categories,
    hits,
    protectedPaths: hits.filter((h) => RESTRICTION_ORDER[h.restriction] >= RESTRICTION_ORDER.protected).map((h) => h.path),
    controlPlanePaths: hits.filter((h) => RESTRICTION_ORDER[h.restriction] >= RESTRICTION_ORDER.control_plane).map((h) => h.path),
    immutablePaths: hits.filter((h) => h.restriction === "immutable").map((h) => h.path),
  };
}

/**
 * Static pre-flight classification of a task's files_allowed globs (before any file exists).
 * Conservative: a glob is raised by every rule whose literal prefix could overlap it.
 * Rules that begin with a wildcard cannot be pre-evaluated and are applied only to concrete paths.
 */
export function taskPreflight(filesAllowed, policy) {
  const categories = new Set();
  let restriction = "none";
  const notes = [];
  for (const glob of filesAllowed) {
    const prefix = staticPrefix(glob);
    if (prefix === "") {
      notes.push(`"${glob}" starts with a wildcard and cannot be pre-classified`);
      continue;
    }
    let matchedAny = false;
    for (const rule of policy.path_rules) {
      for (const rp of rule.patterns) {
        const rprefix = staticPrefix(rp);
        if (rprefix === "") continue;
        if (!(prefix.startsWith(rprefix) || rprefix.startsWith(prefix))) continue;
        const wholeSubtreeExcluded = (rule.exclude || []).some((ex) => ex.endsWith("/**") && prefix.startsWith(ex.slice(0, -2)));
        if (wholeSubtreeExcluded) continue;
        matchedAny = true;
        categories.add(rule.category);
        restriction = maxRestriction(restriction, rule.restriction);
      }
    }
    if (!matchedAny) categories.add(policy.classification.unmatched_path_category);
  }
  const cls = maxClass(...[...categories].map((c) => policy.risk_categories[c].minimum_class));
  return { class: cls, categories: [...categories], restriction, notes };
}

/**
 * May a worker change `path`? A control-plane path is allowed only when a files_allowed glob that matches it
 * is at least as specific as the control-plane rule pattern it falls under (so docs/** cannot silently
 * cover docs/project-memory/policy/**).
 */
export function pathPermission(path, task, policy) {
  const p = normalizePath(path);
  const cls = classifyPath(p, policy);
  const reasons = [];
  if (cls.restriction === "immutable") reasons.push("matches an immutable path rule");
  if (matchesAny(task.files_forbidden, p)) reasons.push("matches files_forbidden");
  if (!matchesAny(task.files_allowed, p)) reasons.push("does not match any files_allowed glob");
  if (cls.restriction === "control_plane") {
    const controlRules = policy.path_rules.filter((r) => r.restriction === "control_plane" && ruleApplies(r, p));
    const explicit = task.files_allowed.some(
      (g) => matchesGlob(g, p) && controlRules.some((r) => r.patterns.some((rp) => matchesGlob(rp, p) && staticPrefix(g).startsWith(staticPrefix(rp)))),
    );
    if (!explicit) reasons.push("is a control-plane path that files_allowed does not list explicitly");
  }
  return { allowed: reasons.length === 0, reasons, classification: cls };
}
