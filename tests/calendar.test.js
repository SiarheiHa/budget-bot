import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WEEKDAYS,
  daysInMonth,
  shiftMonth,
  formatIsoDate,
  formatIsoMonth,
  parseIsoDate,
  buildMonthGrid,
  buildCalendarText,
  parseCalendarCallback,
} from "../src/calendar.js";
import { createCalendarKeyboard } from "../src/keyboards.js";

test("daysInMonth: обычный и високосный год", () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2025, 2), 28);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 1), 31);
});

test("shiftMonth: переход через границы года", () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 10, 0), { year: 2026, month: 10 });
  assert.deepEqual(shiftMonth(2026, 1, -13), { year: 2024, month: 12 });
});

test("formatIsoDate / formatIsoMonth: ведущие нули", () => {
  assert.equal(formatIsoDate(2026, 1, 5), "2026-01-05");
  assert.equal(formatIsoMonth(2026, 1), "2026-01");
});

test("parseIsoDate: валидные и невалидные даты", () => {
  assert.deepEqual(parseIsoDate("2026-01-05"), {
    year: 2026,
    month: 1,
    day: 5,
  });
  assert.equal(parseIsoDate("2026-02-30"), null);
  assert.equal(parseIsoDate("2026-13-01"), null);
  assert.equal(parseIsoDate("2026-1-5"), null);
  assert.equal(parseIsoDate("abc"), null);
  assert.equal(parseIsoDate(null), null);
});

test("buildMonthGrid: октябрь 2026 начинается с четверга", () => {
  const weeks = buildMonthGrid(2026, 10);

  assert.equal(weeks.length, 5);
  assert.ok(weeks.every((week) => week.length === 7));

  const days = weeks.flat().filter(Boolean);
  assert.equal(days.length, 31);
  assert.deepEqual(days[0], { year: 2026, month: 10, day: 1 });

  assert.equal(weeks[0][0], null);
  assert.equal(weeks[0][1], null);
  assert.equal(weeks[0][2], null);
  assert.equal(weeks[0][3].day, 1);
});

test("buildMonthGrid: февраль високосного года", () => {
  const days = buildMonthGrid(2024, 2).flat().filter(Boolean);
  assert.equal(days.length, 29);
  assert.equal(days[28].day, 29);
});

test("buildCalendarText: только месяц и год", () => {
  const text = buildCalendarText(2026, 10);
  assert.equal(text, "Октябрь 2026");
  assert.doesNotMatch(text, /Пн/);
});

test("parseCalendarCallback: навигация, дни и быстрые кнопки", () => {
  assert.deepEqual(parseCalendarCallback("cal:noop"), { type: "noop" });
  assert.deepEqual(parseCalendarCallback("cal:today"), { type: "today" });
  assert.deepEqual(parseCalendarCallback("cal:yesterday"), {
    type: "yesterday",
  });
  assert.deepEqual(parseCalendarCallback("cal:nav:2026-09"), {
    type: "nav",
    year: 2026,
    month: 9,
  });
  assert.deepEqual(parseCalendarCallback("cal:day:2026-10-31"), {
    type: "day",
    year: 2026,
    month: 10,
    day: 31,
  });
  assert.equal(parseCalendarCallback("cal:nav:2026-13"), null);
  assert.equal(parseCalendarCallback("cal:day:2026-02-30"), null);
  assert.equal(parseCalendarCallback("unknown"), null);

  assert.deepEqual(parseCalendarCallback("ai:cal:today", "ai:cal"), {
    type: "today",
  });
  assert.deepEqual(parseCalendarCallback("ai:cal:nav:2026-09", "ai:cal"), {
    type: "nav",
    year: 2026,
    month: 9,
  });
  assert.equal(parseCalendarCallback("cal:toda", "ai:cal"), null);
});

test("createCalendarKeyboard: навигация, дни и кнопки", () => {
  const rows = createCalendarKeyboard(2026, 10).reply_markup.inline_keyboard;
  const buttons = rows.flat();

  assert.equal(rows[0][0].callback_data, "cal:nav:2026-09");
  assert.equal(rows[0][1].callback_data, "cal:nav:2026-11");

  const weekdayRow = rows[1];
  assert.deepEqual(
    weekdayRow.map((button) => button.text),
    WEEKDAYS
  );
  assert.ok(weekdayRow.every((button) => button.callback_data === "cal:noop"));

  assert.equal(weekdayRow[3].text, "Чт");
  assert.equal(rows[2][3].callback_data, "cal:day:2026-10-01");

  const dayButtons = buttons.filter((button) =>
    button.callback_data.startsWith("cal:day:")
  );
  assert.equal(dayButtons.length, 31);
  assert.ok(
    dayButtons.some(
      (button) => button.callback_data === "cal:day:2026-10-31"
    )
  );

  assert.ok(buttons.some((button) => button.callback_data === "cal:today"));
  assert.ok(buttons.some((button) => button.callback_data === "cal:yesterday"));
  assert.ok(buttons.some((button) => button.callback_data === "v1:cancel"));
});
