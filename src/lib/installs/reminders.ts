export type AccessReminderCadence = {
  weekly: boolean;
  finalDaysBeforeStart: number;
};

export type AccessReminderInstall = {
  bookedOn: string;
  startOn: string;
  today: string;
  submitted: boolean;
  mediaCount: number;
  lastReminderOn: string | null;
};

function utcDay(iso: string) {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

function daysBetween(earlier: string, later: string) {
  return Math.round((utcDay(later) - utcDay(earlier)) / 86_400_000);
}

function addDays(iso: string, days: number) {
  return new Date(utcDay(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

function dueOn(day: string, bookedOn: string, startOn: string, cadence: AccessReminderCadence) {
  if (day >= startOn) return false;
  const sinceBooking = daysBetween(bookedOn, day);
  const untilStart = daysBetween(day, startOn);
  const weekly = cadence.weekly && sinceBooking > 0 && sinceBooking % 7 === 0;
  const final = cadence.finalDaysBeforeStart > 0 && untilStart === cadence.finalDaysBeforeStart;
  return weekly || final;
}

/**
 * Weekly from the booking date, plus one reminder the set number of days before the start.
 * A missed cron day is caught up on the next run. Nothing goes out on or after the install
 * start, or once the form has been submitted, even when no photos were added.
 */
export function accessReminderDue(item: AccessReminderInstall, cadence: AccessReminderCadence) {
  if (item.today >= item.startOn) return false;
  if (item.submitted) return false;
  const cursor = item.lastReminderOn ?? item.bookedOn;
  const span = daysBetween(cursor, item.today);
  if (span <= 0) return false;
  for (let offset = 1; offset <= span; offset += 1) {
    if (dueOn(addDays(cursor, offset), item.bookedOn, item.startOn, cadence)) return true;
  }
  return false;
}
