/** A calendar date like Python's datetime.date: proleptic Gregorian, no time zone. */

import { pyInt, strip } from "./py.ts";

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeap(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeap(year) ? 29 : DAYS_IN_MONTH[month - 1]!;
}

export class PyDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;

  /** Throws like date(year, month, day) for a day that does not exist. */
  constructor(year: number, month: number, day: number) {
    if (!Number.isInteger(year) || year < 1 || year > 9999) throw new RangeError("year is out of range");
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError("month must be in 1..12");
    if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
      throw new RangeError("day is out of range for month");
    }
    this.year = year;
    this.month = month;
    this.day = day;
  }

  static today(): PyDate {
    const now = new Date();
    return new PyDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  /** Days since 0001-01-01 plus one, like date.toordinal(). */
  ordinal(): number {
    const y = this.year - 1;
    let days = y * 365 + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400);
    for (let m = 1; m < this.month; m++) days += daysInMonth(this.year, m);
    return days + this.day;
  }

  static fromOrdinal(ordinal: number): PyDate {
    let year = Math.max(1, Math.floor((ordinal - 1) / 365.2425) + 1);
    while (new PyDate(year, 1, 1).ordinal() > ordinal) year--;
    while (year < 9999 && new PyDate(year + 1, 1, 1).ordinal() <= ordinal) year++;
    let rest = ordinal - new PyDate(year, 1, 1).ordinal() + 1;
    let month = 1;
    while (rest > daysInMonth(year, month)) {
      rest -= daysInMonth(year, month);
      month++;
    }
    return new PyDate(year, month, rest);
  }

  addDays(days: number): PyDate {
    return PyDate.fromOrdinal(this.ordinal() + days);
  }

  /** Monday is 0, Sunday is 6. */
  weekday(): number {
    return (this.ordinal() + 6) % 7;
  }

  isoformat(): string {
    return String(this.year).padStart(4, "0") + "-" + String(this.month).padStart(2, "0") + "-"
      + String(this.day).padStart(2, "0");
  }

  toString(): string {
    return this.isoformat();
  }

  compare(other: PyDate): number {
    return this.ordinal() - other.ordinal();
  }

  /** date.replace(day=...). */
  withDay(day: number): PyDate {
    return new PyDate(this.year, this.month, day);
  }

  /**
   * date.fromisoformat() of Python 3.11+: `YYYY-MM-DD`, `YYYYMMDD` and ISO week dates.
   * Throws RangeError for anything else.
   */
  static fromIso(value: string): PyDate {
    let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (match) return new PyDate(Number(match[1]), Number(match[2]), Number(match[3]));
    match = /^(\d{4})-W(\d{2})(?:-(\d))?$/.exec(value) ?? /^(\d{4})W(\d{2})(\d)?$/.exec(value);
    if (match) return PyDate.fromIsoWeek(Number(match[1]), Number(match[2]), match[3] ? Number(match[3]) : 1);
    throw new RangeError("Invalid isoformat string: " + value);
  }

  static fromIsoWeek(year: number, week: number, day: number): PyDate {
    if (day < 1 || day > 7) throw new RangeError("Invalid weekday");
    const jan4 = new PyDate(year, 1, 4);
    const firstMonday = jan4.addDays(-jan4.weekday());
    const lastWeek = new PyDate(year, 12, 28);
    const weeks = Math.floor((lastWeek.ordinal() - firstMonday.ordinal()) / 7) + 1;
    if (week < 1 || week > weeks) throw new RangeError("Invalid week");
    return firstMonday.addDays((week - 1) * 7 + day - 1);
  }

  /** datetime.strptime(value, format).date() for the formats rcllr uses: %Y, %m, %d and literals. */
  static strptime(value: string, pattern: string): PyDate {
    let source = "";
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i]!;
      if (char === "%" && i + 1 < pattern.length) {
        const code = pattern[++i];
        if (code === "Y") source += "(?<Y>\\p{Nd}{4})";
        else if (code === "m") source += "(?<m>1[0-2]|0[1-9]|[1-9])";
        else if (code === "d") source += "(?<d>3[01]|[12]\\p{Nd}|0[1-9]|[1-9]| [1-9])";
        else throw new Error("unsupported directive %" + code);
      } else if (/\s/.test(char)) {
        source += "\\s+";
      } else {
        source += char.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
      }
    }
    const match = new RegExp("^" + source + "$", "iu").exec(value);
    if (!match?.groups) throw new RangeError("time data does not match format");
    return new PyDate(pyInt(match.groups.Y ?? "1900"), pyInt(match.groups.m ?? "1"), pyInt(strip(match.groups.d ?? "1")));
  }
}
