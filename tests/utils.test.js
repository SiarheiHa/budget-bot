import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDateDDMMYYYY, parseAmount, formatDateToDisplay } from '../src/utils.js';

test('parseDateDDMMYYYY: full date DD.MM.YYYY', () => {
  const d = parseDateDDMMYYYY('13.09.2025');
  assert.ok(d instanceof Date);
  assert.equal(d.getFullYear(), 2025);
  assert.equal(d.getMonth() + 1, 9);
  assert.equal(d.getDate(), 13);
});

test('parseDateDDMMYYYY: separators / and -', () => {
  const d1 = parseDateDDMMYYYY('13/09/2025');
  const d2 = parseDateDDMMYYYY('13-09-2025');
  assert.ok(d1 instanceof Date);
  assert.ok(d2 instanceof Date);
});

test('parseDateDDMMYYYY: short year', () => {
  const d = parseDateDDMMYYYY('01.01.25');
  assert.ok(d instanceof Date);
  assert.equal(d.getFullYear(), 2025);
});

test('parseDateDDMMYYYY: invalid returns null', () => {
  assert.equal(parseDateDDMMYYYY('32.01.2025'), null);
  assert.equal(parseDateDDMMYYYY('abc'), null);
  assert.equal(parseDateDDMMYYYY(''), null);
});

test('parseAmount: dot and comma', () => {
  assert.equal(parseAmount('123.45'), 123.45);
  assert.equal(parseAmount('123,45'), 123.45);
});

test('parseAmount: spaces', () => {
  assert.equal(parseAmount('1 000,50'), 1000.5);
});

test('parseAmount: invalid returns NaN', () => {
  assert.equal(Number.isNaN(parseAmount('abc')), true);
});

test('formatDateToDisplay', () => {
  const d = new Date(2025, 8, 13); // Sep 13 2025
  assert.equal(formatDateToDisplay(d), '13.09.2025');
});
