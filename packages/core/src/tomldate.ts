/** Range checks for TOML date-times: the parser's regex checks the shape, this checks the calendar. */

const DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const TIME = /(?:^|[Tt ])(\d{2}):(\d{2}):(\d{2})/;
const OFFSET = /[+-](\d{2}):(\d{2})$/;

/** Returns why the date-time is out of range, or undefined when it is fine. Leap second 60 is allowed. */
export function dateTimeProblem(text: string): string | undefined {
  const date = DATE.exec(text);
  if (date) {
    const year = Number(date[1]);
    const month = Number(date[2]);
    const day = Number(date[3]);
    if (month < 1 || month > 12) return "Month out of range";
    if (day < 1 || day > daysInMonth(year, month)) return "Day out of range";
  }
  const time = TIME.exec(text);
  if (time && (Number(time[1]) > 23 || Number(time[2]) > 59 || Number(time[3]) > 60)) return "Time out of range";
  const offset = date && time ? OFFSET.exec(text) : null;
  if (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59)) return "Offset out of range";
  return undefined;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
