/**
 * Permission catalogue and roles (N-15a).
 *
 * A permission is resource x action x scope. Every scope is "all" today; per-world or
 * per-item scope comes with the release workflow (N-21).
 * A role is a bundle of permissions. Roles live only in users.role: no env variable grants
 * a role (the old REVIEWER_IDS path is removed).
 * The editorial roles come from EDITORIAL_POLICY.md. Until N-21 adds the release steps, each
 * editorial role holds the same bundle the single `reviewer` role held, so no route changes
 * what it allows.
 */
export type Scope = "all";
export type Permission = { resource: string; action: string; scope: Scope };

export const CATALOGUE = {
  "archive.read_full": { resource: "archive", action: "read_full", scope: "all" },
  "content.import": { resource: "content", action: "import", scope: "all" },
  "content.edit": { resource: "content", action: "edit", scope: "all" },
  "review.read": { resource: "review", action: "read", scope: "all" },
  "review.record": { resource: "review", action: "record", scope: "all" },
  "corrections.manage": { resource: "corrections", action: "manage", scope: "all" },
  "visuals.read_queue": { resource: "visuals", action: "read_queue", scope: "all" },
  "editorial.read_dashboard": { resource: "editorial", action: "read_dashboard", scope: "all" },
  "users.manage": { resource: "users", action: "manage", scope: "all" },
  "settings.manage": { resource: "settings", action: "manage", scope: "all" },
  "audit.read": { resource: "audit", action: "read", scope: "all" },
} as const satisfies Record<string, Permission>;

export type PermissionKey = keyof typeof CATALOGUE;

const EDITORIAL: readonly PermissionKey[] = [
  "archive.read_full", "content.import", "content.edit", "review.read", "review.record",
  "corrections.manage", "visuals.read_queue", "editorial.read_dashboard",
];
const ALL = Object.keys(CATALOGUE) as PermissionKey[];

export const ROLES = ["learner", "researcher", "fact_checker", "language_editor", "scholar", "publisher", "reviewer", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_BUNDLES: Record<Role, readonly PermissionKey[]> = {
  learner: [],
  researcher: EDITORIAL,
  fact_checker: EDITORIAL,
  language_editor: EDITORIAL,
  scholar: EDITORIAL,
  publisher: EDITORIAL,
  reviewer: EDITORIAL,
  admin: ALL,
};

const isRole = (role: string): role is Role => (ROLES as readonly string[]).includes(role);

/** Staff = a known role that holds at least one permission. */
export const STAFF_ROLES: ReadonlySet<Role> = new Set(ROLES.filter((r) => ROLE_BUNDLES[r].length > 0));

export function isStaffRole(role: string): boolean {
  return isRole(role) && STAFF_ROLES.has(role);
}

/** True when the role's bundle holds the permission. An unknown role holds nothing. */
export function can(role: string, permission: PermissionKey): boolean {
  return isRole(role) && ROLE_BUNDLES[role].includes(permission);
}
