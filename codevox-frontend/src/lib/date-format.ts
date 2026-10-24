/** API / storage dates are always ISO YYYY-MM-DD. UI displays dd/mm/yyyy. */

/** Primary display formatter - use for any date shown in the UI. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const day = String(value.getUTCDate()).padStart(2, '0');
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const year = value.getUTCFullYear();
    return `${day}/${month}/${year}`;
  }
  return formatTimestampDateDisplay(value);
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDateString(value: string): boolean {
  return ISO_RE.test(value.slice(0, 10));
}

/** ISO → dd/mm/yyyy */
export function formatIsoDateDisplay(iso: string): string {
  const m = ISO_RE.exec(iso.slice(0, 10));
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** ISO → dd/mm/yy */
export function formatIsoDateDisplayShortYear(iso: string): string {
  const m = ISO_RE.exec(iso.slice(0, 10));
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]!.slice(-2)}`;
}

/** dd/mm/yyyy, dd/mm/yy, or dd-mm-yyyy → ISO, or null if invalid */
export function parseDisplayDateToIso(input: string): string | null {
  const s = input.trim();
  const iso = ISO_RE.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy4 = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  const dmy2 = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/.exec(s);
  const dmy = dmy4 ?? dmy2;
  if (!dmy) return null;

  const day = parseInt(dmy[1]!, 10);
  const month = parseInt(dmy[2]!, 10);
  let year = parseInt(dmy[3]!, 10);
  if (!dmy4) {
    // 00-69 → 2000-2069, 70-99 → 1970-1999
    year = year <= 69 ? 2000 + year : 1900 + year;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const out = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const check = new Date(`${out}T12:00:00Z`);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return out;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** e.g. "Wednesday, 21/05/2025" */
export function formatIsoDateLong(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return formatIsoDateDisplay(iso);
  const wd = WEEKDAY[d.getUTCDay()] ?? '';
  return `${wd}, ${formatIsoDateDisplay(iso)}`;
}

/** Short day header: "Wed 21/05/2025" */
export function formatIsoDateShort(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return formatIsoDateDisplay(iso);
  const wd = WEEKDAY[d.getUTCDay()] ?? '';
  return `${wd} ${formatIsoDateDisplay(iso)}`;
}

const ISO_MONTH_RE = /^(\d{4})-(\d{2})$/;

/** `YYYY-MM` → `01/06/2026 - 30/06/2026` */
export function formatMonthRangeDisplay(monthIso: string): string {
  const m = ISO_MONTH_RE.exec(monthIso.trim());
  if (!m) return monthIso;
  const y = parseInt(m[1]!, 10);
  const mo = parseInt(m[2]!, 10);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `01/${pad(mo)}/${y} - ${pad(last)}/${pad(mo)}/${y}`;
}

/** Shift `YYYY-MM` by delta months. */
export function shiftMonth(monthIso: string, delta: number): string {
  const m = ISO_MONTH_RE.exec(monthIso.trim());
  if (!m) return monthIso;
  let y = parseInt(m[1]!, 10);
  let mo = parseInt(m[2]!, 10) + delta;
  while (mo < 1) {
    mo += 12;
    y -= 1;
  }
  while (mo > 12) {
    mo -= 12;
    y += 1;
  }
  return `${y}-${String(mo).padStart(2, '0')}`;
}

export function currentMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Timestamp or ISO date → dd/mm/yyyy (date part only) */
export function formatTimestampDateDisplay(iso: string): string {
  if (!iso) return '';
  const datePart = iso.slice(0, 10);
  if (isIsoDateString(datePart)) return formatIsoDateDisplay(datePart);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

/** Week range label with dd/mm/yyyy */
export function formatIsoRangeDisplay(startIso: string, endIso: string): string {
  const s = formatIsoDateDisplay(startIso);
  const e = formatIsoDateDisplay(endIso);
  const y1 = startIso.slice(0, 4);
  const y2 = endIso.slice(0, 4);
  if (y1 !== y2) return `${s} - ${e}`;
  if (startIso.slice(5, 10) === endIso.slice(5, 10)) return s;
  const sParts = s.split('/');
  const eParts = e.split('/');
  return `${sParts[0]}/${sParts[1]} - ${eParts[0]}/${eParts[1]}/${eParts[2]}`;
}

const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const ISO_WEEK_RE = /^(\d{4})-W(\d{2})$/;

function isoWeekMondayIso(year: number, week: number): string {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - dow + 1);
  const monday = new Date(mondayWeek1);
  monday.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const d = String(monday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Report chart/table period keys → dd/mm/yyyy (or month/quarter/week labels). */
export function formatReportPeriodLabel(period: string): string {
  const day = ISO_DAY_RE.exec(period);
  if (day) {
    return `${day[3]}/${day[2]}/${day[1]}`;
  }
  const month = ISO_MONTH_RE.exec(period);
  if (month) {
    return `01/${month[2]}/${month[1]}`;
  }
  const quarter = ISO_QUARTER_RE.exec(period);
  if (quarter) {
    return `Q${quarter[2]} ${quarter[1]}`;
  }
  const week = ISO_WEEK_RE.exec(period);
  if (week) {
    const monday = isoWeekMondayIso(
      parseInt(week[1]!, 10),
      parseInt(week[2]!, 10),
    );
    return formatIsoDateDisplay(monday);
  }
  return period;
}

/** Timestamp → dd/mm/yyyy, HH:mm (local). */
export function formatTimestampDateTimeDisplay(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return formatTimestampDateDisplay(iso);
  }
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year}, ${hours}:${minutes}`;
}
