const churchSections = new Set([
  "access",
  "attendance",
  "bans",
  "care",
  "config",
  "expense",
  "families",
  "forms",
  "giving",
  "members",
  "overview",
  "rites",
  "roles",
  "worship",
]);
const reservedCodes = new Set(["API", "ASSETS", "OWNER"]);

export function isChurchSection(page: string) {
  return churchSections.has(page);
}

export function churchPage(pathname: string) {
  const match = /^\/([a-z0-9-]{1,100})(?:\/([a-z-]+))?$/i.exec(pathname);
  const code = match?.[1]?.toUpperCase();
  const page = match?.[2]?.toLowerCase() ?? "";
  if (
    !code ||
    reservedCodes.has(code) ||
    (page &&
      !churchSections.has(page) &&
      !["change-password", "login", "portal", "support"].includes(page))
  )
    return null;
  return { code, page };
}

export function churchPagePath(code: string, page: string) {
  return `/${code}${page ? `/${page}` : ""}`;
}
