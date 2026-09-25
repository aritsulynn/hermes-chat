const NON_NETWORK_SCHEME = /^(?:data|blob):/i;
const DASHBOARD_MEDIA_PATH = /^\/(?:api|static|assets|files)(?:\/|$)/i;

function parseUrl(value: string, base?: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

/** Return the path relative to a dashboard base path, or null when it escapes it. */
function pathRelativeToBase(
  targetPath: string,
  basePath: string,
): string | null {
  const prefix = basePath.replace(/\/+$/, "");
  if (!prefix || prefix === "") return targetPath;
  if (targetPath === prefix) return "/";
  if (targetPath.startsWith(`${prefix}/`))
    return targetPath.slice(prefix.length) || "/";
  return null;
}

/**
 * True only for URLs served by the configured dashboard origin and one of the
 * dashboard-owned web paths. This is intentionally narrower than "any HTTP URL":
 * session cookies must never be forwarded to third-party image hosts.
 */
export function isDashboardMediaUri(
  uri: string,
  dashboardBase: string,
): boolean {
  if (!uri || !dashboardBase || NON_NETWORK_SCHEME.test(uri)) return false;

  const base = parseUrl(dashboardBase);
  const target = parseUrl(uri, dashboardBase);
  if (!base || !target) return false;
  if (base.username || base.password || target.username || target.password)
    return false;
  if (target.origin !== base.origin) return false;

  const relativePath = pathRelativeToBase(target.pathname, base.pathname);
  return relativePath !== null && DASHBOARD_MEDIA_PATH.test(relativePath);
}

export function shouldAttachDashboardCookie(
  uri: string,
  dashboardBase: string,
): boolean {
  return isDashboardMediaUri(uri, dashboardBase);
}

/** Build an Image source without leaking the dashboard cookie off-origin. */
export function buildImageSource(
  uri: string,
  dashboardBase: string,
  cookie: string,
) {
  return {
    uri,
    ...(cookie && shouldAttachDashboardCookie(uri, dashboardBase)
      ? { headers: { Cookie: cookie } }
      : {}),
  };
}
