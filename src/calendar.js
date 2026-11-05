export const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

export const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function pad(value, length = 2) {
  return String(value).padStart(length, "0");
}

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function shiftMonth(year, month, delta) {
  const total = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonth = ((total % 12) + 12) % 12;
  return { year: nextYear, month: nextMonth + 1 };
}

export function formatIsoDate(year, month, day) {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function formatIsoMonth(year, month) {
  return `${pad(year, 4)}-${pad(month)}`;
}

export function parseIsoDate(value) {
  if (typeof value !== "string") return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  return { year, month, day };
}

export function buildMonthGrid(year, month) {
  const firstDay = new Date(year, month - 1, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const totalDays = daysInMonth(year, month);

  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push(null);
  for (let day = 1; day <= totalDays; day += 1) {
    cells.push({ year, month, day });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

export function buildCalendarText(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function parseCalendarCallback(data, prefix = "cal") {
  if (typeof data !== "string") return null;

  const prefixWithSeparator = `${prefix}:`;
  if (!data.startsWith(prefixWithSeparator)) return null;

  const value = data.slice(prefixWithSeparator.length);

  if (value === "noop") return { type: "noop" };
  if (value === "today") return { type: "today" };
  if (value === "yesterday") return { type: "yesterday" };

  const navMatch = /^nav:(\d{4})-(\d{2})$/.exec(value);
  if (navMatch) {
    const year = Number(navMatch[1]);
    const month = Number(navMatch[2]);
    if (month >= 1 && month <= 12) return { type: "nav", year, month };
    return null;
  }

  const dayMatch = /^day:(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dayMatch) {
    const date = parseIsoDate(`${dayMatch[1]}-${dayMatch[2]}-${dayMatch[3]}`);
    if (date) return { type: "day", ...date };
  }

  return null;
}

export function resolveCalendarDate(parsed, now = new Date()) {
  if (parsed.type === "today" || parsed.type === "yesterday") {
    const dayOffset = parsed.type === "yesterday" ? -1 : 0;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
  }

  return new Date(parsed.year, parsed.month - 1, parsed.day);
}
