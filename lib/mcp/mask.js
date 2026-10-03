/**
 * Redaction of credentials before any discovered configuration is reported.
 *
 * Imported configuration carries API keys in `env` values and `headers`, and a
 * report reaches the model transcript. Values whose key looks like a credential
 * are replaced, and query parameters and user information inside endpoint URLs
 * are removed, so a preview never becomes a credential leak.
 *
 * @module dsh-external-import/mcp/mask
 */
/** Key names whose values are treated as credentials. */
const SECRET_KEY = /(key|token|secret|password|passwd|credential|auth|cookie|session|bearer|pat)/i;
/** Placeholder written in place of a redacted value. */
export const REDACTED = '<redacted>';
/**
 * Redact one value when its key looks like a credential.
 * @param key - configuration key the value belongs to.
 * @param value - configuration value.
 * @returns the original value, or {@link REDACTED}.
 */
export function maskValue(key, value) {
    return SECRET_KEY.test(key) ? REDACTED : value;
}
/**
 * Redact credential-looking entries of a key/value map.
 * @param values - environment or header values.
 * @returns a copy with credential values replaced.
 */
export function maskRecord(values) {
    const masked = {};
    for (const [key, value] of Object.entries(values))
        masked[key] = maskValue(key, value);
    return masked;
}
/**
 * Remove credentials embedded in an endpoint URL.
 * @param url - endpoint as configured.
 * @returns the URL without user information or credential query parameters.
 */
export function maskUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return redactInlineTokens(url);
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
        parsed.username = '';
        parsed.password = '';
    }
    for (const [key] of parsed.searchParams) {
        if (SECRET_KEY.test(key))
            parsed.searchParams.set(key, REDACTED);
    }
    return parsed.toString();
}
/** Redact query parameters of a URL that cannot be parsed. */
function redactInlineTokens(url) {
    return url.replace(/([?&][^=&#]*)/g, (match) => (SECRET_KEY.test(match) ? `${match}=${REDACTED}` : match));
}
