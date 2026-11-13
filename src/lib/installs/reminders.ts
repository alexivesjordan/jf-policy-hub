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

/**
 * Weekly from the booking date, plus one reminder the set number of days before the start.
 * Nothing goes out on or after the install start, or once a photo or video is in.
 */
export function accessReminderDue(item: AccessReminderInstall, cadence: AccessReminderCadence) {
  if (item.today >= item.startOn) return false;
  if (item.submitted && item.mediaCount > 0) return false;
  if (item.lastReminderOn === item.today) return false;
  const sinceBooking = daysBetween(item.bookedOn, item.today);
  const untilStart = daysBetween(item.today, item.startOn);
  const weekly = cadence.weekly && sinceBooking > 0 && sinceBooking % 7 === 0;
  const final = cadence.finalDaysBeforeStart > 0 && untilStart === cadence.finalDaysBeforeStart;
  return weekly || final;
}
