import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeState, decodeState } from '../js/url-state.js';

test('encodeState writes only values that differ from the defaults', () => {
  const defaults = { mode: '2d', 'regular-sides': '6', 'ann-unit': '' };
  assert.equal(encodeState({ ...defaults }, defaults), '');
  assert.equal(encodeState({ ...defaults, 'regular-sides': '5' }, defaults), 'regular-sides=5');
});

test('encodeState keeps keys that have no default', () => {
  assert.equal(encodeState({ gl0: '40' }, {}), 'gl0=40');
});

test('decodeState round-trips unicode, spaces and symbols', () => {
  const state = { mode: '3d', 'ann-unit': 'cm²', note: 'a b&c=d#e' };
  assert.deepEqual(decodeState('#' + encodeState(state)), state);
  assert.deepEqual(decodeState(encodeState(state)), state);
});

test('decodeState of an empty or missing hash is an empty object', () => {
  assert.deepEqual(decodeState(''), {});
  assert.deepEqual(decodeState('#'), {});
  assert.deepEqual(decodeState(undefined), {});
});
