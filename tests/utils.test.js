import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDateDDMMYYYY,
  parseNaturalDate,
  parseAmount,
  formatDateToDisplay,
  normalizeCategoryType,
  scheduleDeleteMessage,
} from '../src/utils.js';

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

test('parseAmount: negative values', () => {
  assert.equal(parseAmount('-500'), -500);
  assert.equal(parseAmount('−500,50'), -500.5);
});

test('parseAmount: invalid returns NaN', () => {
  assert.equal(Number.isNaN(parseAmount('abc')), true);
});

test('formatDateToDisplay', () => {
  const d = new Date(2025, 8, 13); // Sep 13 2025
  assert.equal(formatDateToDisplay(d), '13.09.2025');
});

const NOW = new Date(2026, 10, 4); // Nov 4 2026

function ymd(date) {
  return [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  ];
}

test('parseNaturalDate: сегодня и вчера', () => {
  assert.deepEqual(ymd(parseNaturalDate('сегодня', NOW)), [2026, 11, 4]);
  assert.deepEqual(ymd(parseNaturalDate('вчера', NOW)), [2026, 11, 3]);
  assert.deepEqual(ymd(parseNaturalDate('позавчера', NOW)), [2026, 11, 2]);
});

test('parseNaturalDate: день и месяц словом', () => {
  assert.deepEqual(ymd(parseNaturalDate('9 октября', NOW)), [2026, 10, 9]);
  assert.deepEqual(ymd(parseNaturalDate('9-го октября', NOW)), [2026, 10, 9]);
  assert.deepEqual(ymd(parseNaturalDate('октября 9', NOW)), [2026, 10, 9]);
  assert.deepEqual(ymd(parseNaturalDate('9 октября 2025 г.', NOW)), [
    2025, 10, 9,
  ]);
});

test('parseNaturalDate: числовые форматы', () => {
  assert.deepEqual(ymd(parseNaturalDate('3.10', NOW)), [2026, 10, 3]);
  assert.deepEqual(ymd(parseNaturalDate('03/10/2026', NOW)), [2026, 10, 3]);
  assert.deepEqual(ymd(parseNaturalDate('03-10-26', NOW)), [2026, 10, 3]);
  assert.deepEqual(ymd(parseNaturalDate('2026-10-03', NOW)), [2026, 10, 3]);
});

test('parseNaturalDate: невалидные значения', () => {
  assert.equal(parseNaturalDate('32 октября', NOW), null);
  assert.equal(parseNaturalDate('9 смородины', NOW), null);
  assert.equal(parseNaturalDate('не дата', NOW), null);
  assert.equal(parseNaturalDate('', NOW), null);
});

test('scheduleDeleteMessage: удаляет сообщение через переданный планировщик', () => {
  const deleted = [];
  const bot = {
    deleteMessage: async (chatId, messageId) => {
      deleted.push({ chatId, messageId });
    },
  };
  let scheduled;

  scheduleDeleteMessage(bot, null, 1, 10, 1000, (fn, delayMs) => {
    scheduled = { fn, delayMs };
  });

  assert.equal(scheduled.delayMs, 1000);
  scheduled.fn();
  assert.deepEqual(deleted, [{ chatId: 1, messageId: 10 }]);
});

test('scheduleDeleteMessage: без messageId ничего не планирует', () => {
  let called = false;

  scheduleDeleteMessage({}, null, 1, null, 1000, () => {
    called = true;
  });

  assert.equal(called, false);
});

test('normalizeCategoryType: русские и английские значения', () => {
  assert.equal(normalizeCategoryType(' Доход '), 'income');
  assert.equal(normalizeCategoryType('income'), 'income');
  assert.equal(normalizeCategoryType('Расход'), 'expense');
  assert.equal(normalizeCategoryType('expense'), 'expense');
  assert.equal(normalizeCategoryType('перевод'), 'transfer');
  assert.equal(normalizeCategoryType('transfer'), 'transfer');
  assert.equal(normalizeCategoryType('прочее'), null);
  assert.equal(normalizeCategoryType(''), null);
  assert.equal(normalizeCategoryType(null), null);
});
