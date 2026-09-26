// Form state <-> URL hash. Pure (no DOM) so it is unit tested under Node.
// State is a flat { key: string } map; only keys whose value differs from the
// defaults are written, which keeps shared links short and readable.

/**
 * @param {Record<string,string>} state
 * @param {Record<string,string>} defaults
 * @returns {string} hash body without the leading '#' ('' when nothing differs)
 */
export function encodeState(state, defaults = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) {
    if (defaults[key] !== value) params.set(key, value);
  }
  return params.toString();
}

/**
 * @param {string} hash location.hash, with or without the leading '#'
 * @returns {Record<string,string>}
 */
export function decodeState(hash) {
  const body = String(hash ?? '').replace(/^#/, '');
  const state = {};
  for (const [key, value] of new URLSearchParams(body)) state[key] = value;
  return state;
}
