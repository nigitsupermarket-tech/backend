// backend/src/utils/roleHierarchy.ts
//
// Central definition of the staff role hierarchy, used anywhere a role needs
// to be compared against another — user-management visibility, and who can
// assign/demote which roles. Lower rank number = more senior.
//
//   ADMIN (0)  >  MANAGER (1)  >  STAFF (2)  >  ACCOUNTANT / SALES (3)  >  CUSTOMER (4)
//
// ACCOUNTANT and SALES sit at the same tier — both report to STAFF and
// neither outranks the other, so STAFF can move a user laterally between
// them as well as up from CUSTOMER or down to CUSTOMER.

export const ROLE_RANK: Record<string, number> = {
  ADMIN: 0,
  MANAGER: 1,
  STAFF: 2,
  ACCOUNTANT: 3,
  SALES: 3,
  CUSTOMER: 4,
};

// Only ADMIN, MANAGER, and STAFF get a seat in user management at all.
export const USER_MANAGEMENT_ROLES = ["ADMIN", "MANAGER", "STAFF"];

const UNKNOWN_ROLE_RANK = 99; // treat anything unrecognized as lowest-privilege

export function rankOf(role: string | undefined | null): number {
  if (!role) return UNKNOWN_ROLE_RANK;
  return ROLE_RANK[role] ?? UNKNOWN_ROLE_RANK;
}

// Roles strictly more senior than `role` — used to build a visibility
// exclusion filter, e.g. STAFF must never see MANAGER/ADMIN accounts.
export function rolesAbove(role: string): string[] {
  const rank = rankOf(role);
  return Object.keys(ROLE_RANK).filter((r) => ROLE_RANK[r] < rank);
}

// Can `actorRole` change a user currently holding `currentRole` to `newRole`?
// ADMIN is unrestricted. Everyone else may only touch targets that are
// strictly below them in the hierarchy, and may only assign roles that are
// strictly below them — no touching peers/superiors, no promoting anyone to
// your own rank or higher. This single rule covers both "upgrade a customer"
// and "demote a user" (demoting to CUSTOMER is just newRole = CUSTOMER,
// which is always strictly below every staff rank).
export function canAssignRole(
  actorRole: string,
  currentRole: string,
  newRole: string,
): boolean {
  if (actorRole === "ADMIN") return true;
  if (!(newRole in ROLE_RANK)) return false; // reject unknown/typo roles
  const actorRank = rankOf(actorRole);
  return rankOf(currentRole) > actorRank && rankOf(newRole) > actorRank;
}

// Can `actorRole` see a user currently holding `targetRole` in user
// management (list/detail)? Peers are visible (e.g. STAFF can see other
// STAFF) — only strictly-more-senior roles are hidden. Editability is a
// separate, stricter check (canAssignRole).
export function canViewRole(actorRole: string, targetRole: string): boolean {
  if (actorRole === "ADMIN") return true;
  return rankOf(targetRole) >= rankOf(actorRole);
}
