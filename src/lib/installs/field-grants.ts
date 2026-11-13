// Field engineers hold operations edit, so a function they can call must either
// be on this list or refuse them in its body. The walk is every install_ and
// subcontractor_ function granted to authenticated, including ones added later.

export const FIELD_ENGINEER_ALLOW = [
  "install_field_home",
  "install_visit_context",
  "install_save_visit_sheet",
  "install_save_visit_risk",
  "install_commit_visit",
  "install_concern_files",
  "install_owned_files",
  "install_my_signature",
  "install_save_staff_signature",
  "install_list_visit_documents",
  "install_read",
  "install_calendar",
  "install_field_role",
  "install_visit_upload_gate",
  "install_list_vans",
] as const;

const ALLOW = new Set<string>(FIELD_ENGINEER_ALLOW);

export function refusesFieldEngineer(body: string) {
  return /if\s+ops\.is_field_engineer\s*\(/i.test(body)
    || /and\s+not\s+ops\.is_field_engineer\s*\(/i.test(body)
    || /perform\s+ops\.refuse_field_engineer\s*\(/i.test(body);
}

type GrantState = {
  name: string;
  body: string;
  viaPublic: boolean;
  viaAuthenticated: boolean;
};

function argTypes(args: string) {
  return args
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const bare = part.replace(/\s+default\s+.+$/i, "").trim();
      const bits = bare.split(/\s+/);
      return bits[bits.length - 1]!.toLowerCase();
    })
    .join(",");
}

function identity(qualified: string, args: string) {
  return `${qualified.toLowerCase()}(${argTypes(args)})`;
}

function shortName(qualified: string) {
  return qualified.split(".").pop() ?? qualified;
}

function mentions(list: string, role: string) {
  return list.split(",").some((item) => item.trim().toLowerCase() === role);
}

export function auditInstallGrants(files: string[]) {
  const sql = files.join("\n").replace(/--[^\n]*/g, "");
  const functions = new Map<string, GrantState>();
  const events: { index: number; run: () => void }[] = [];

  for (const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+((?:public|ops)\.(?:install_|subcontractor_)[a-z0-9_]+)\s*\(([^)]*)\)/gi)) {
    const qualified = match[1]!;
    const args = match[2] ?? "";
    const headerEnd = (match.index ?? 0) + match[0].length;
    const opener = /as\s+(\$[A-Za-z0-9_]*\$)/i.exec(sql.slice(headerEnd));
    if (!opener || opener.index == null) continue;
    const tag = opener[1]!;
    const bodyStart = headerEnd + opener.index + opener[0].length;
    const bodyEnd = sql.indexOf(tag, bodyStart);
    if (bodyEnd < 0) continue;
    const body = sql.slice(bodyStart, bodyEnd);
    const key = identity(qualified, args);
    events.push({
      index: match.index ?? 0,
      run() {
        const existing = functions.get(key);
        functions.set(key, {
          name: shortName(qualified),
          body,
          viaPublic: existing?.viaPublic ?? true,
          viaAuthenticated: existing?.viaAuthenticated ?? false,
        });
      },
    });
  }

  for (const match of sql.matchAll(/(grant|revoke)\s+(?:all|execute)\s+on\s+function\s+((?:public|ops)\.(?:install_|subcontractor_)[a-z0-9_]+)\s*\(([^)]*)\)\s+(to|from)\s+([^;]+)/gi)) {
    const action = match[1]!.toLowerCase();
    const key = identity(match[2]!, match[3] ?? "");
    const direction = match[4]!.toLowerCase();
    const roles = match[5] ?? "";
    if (action === "grant" && direction !== "to") continue;
    if (action === "revoke" && direction !== "from") continue;
    events.push({
      index: match.index ?? 0,
      run() {
        const current = functions.get(key);
        if (!current) return;
        if (action === "grant") {
          if (mentions(roles, "public")) current.viaPublic = true;
          if (mentions(roles, "authenticated")) current.viaAuthenticated = true;
        } else {
          if (mentions(roles, "public")) current.viaPublic = false;
          if (mentions(roles, "authenticated")) current.viaAuthenticated = false;
        }
      },
    });
  }

  for (const match of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?((?:public|ops)\.(?:install_|subcontractor_)[a-z0-9_]+)\s*\(([^)]*)\)/gi)) {
    const key = identity(match[1]!, match[2] ?? "");
    events.push({
      index: match.index ?? 0,
      run() {
        functions.delete(key);
      },
    });
  }

  events.sort((a, b) => a.index - b.index);
  for (const event of events) event.run();

  const granted = [...functions.values()]
    .filter((fn) => fn.viaPublic || fn.viaAuthenticated)
    .map((fn) => fn.name)
    .sort();
  const gaps = [...functions.values()]
    .filter((fn) => (fn.viaPublic || fn.viaAuthenticated) && !ALLOW.has(fn.name) && !refusesFieldEngineer(fn.body))
    .map((fn) => fn.name)
    .sort();
  return { granted, gaps };
}
