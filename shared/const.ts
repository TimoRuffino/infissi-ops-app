export const COOKIE_NAME = "app_session_id";
// Cookie carrying the operator's currently-selected sede (showroom/location).
// Not a secret — server validates membership on every request, so tampering
// only ever resolves back to a sede the user is actually assigned to.
export const SEDE_COOKIE = "active_sede";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
