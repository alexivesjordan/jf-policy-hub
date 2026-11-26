const FACILITIES: { label: string; pattern: RegExp }[] = [
  { label: "Gym", pattern: /\bgym(nasium)?\b/i },
  { label: "Leisure centre", pattern: /leisure\s+cent(re|er)/i },
  { label: "Sports hall", pattern: /sports?\s+hall/i },
  { label: "Hotel fitness", pattern: /\bhotel\b[\s\S]{0,80}\b(gym|fitness|leisure)\b|\b(gym|fitness)\b[\s\S]{0,80}\bhotel\b/i },
  { label: "School sports", pattern: /\b(school|academy)\b[\s\S]{0,80}\b(gym|sports|fitness|leisure)\b|\b(gym|sports hall|leisure)\b[\s\S]{0,80}\b(school|academy)\b/i },
  { label: "University sports", pattern: /\b(university|college)\b[\s\S]{0,80}\b(gym|sports|fitness|leisure)\b/i },
  { label: "Student accommodation", pattern: /student\s+accommodation/i },
  { label: "PBSA", pattern: /\bpbsa\b|purpose[- ]built student/i },
  { label: "Care home", pattern: /care\s+home|nursing\s+home/i },
  { label: "Change of use", pattern: /change of use|class e\s*\(\s*d\s*\)|\buse class d2\b/i },
];

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
const EMAIL = /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i;
const PHONE = /\b((?:\+44\s?|0)\d[\d\s]{8,12}\d)\b/;
const MONEY = /£\s*([\d,]+(?:\.\d+)?)(?:\s*(million|m)\b)?/i;

export function facilityTypes(text: string) {
  const found: string[] = [];
  for (const facility of FACILITIES) {
    if (facility.pattern.test(text) && !found.includes(facility.label)) found.push(facility.label);
  }
  return found.slice(0, 8);
}

export function ukPostcode(text: string) {
  const match = text.match(POSTCODE);
  return match ? match[1].toUpperCase().replace(/\s+/, " ") : null;
}

export function publishedEmail(text: string) {
  const match = text.match(EMAIL);
  return match ? match[1].toLowerCase() : null;
}

export function publishedPhone(text: string) {
  const match = text.match(PHONE);
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

export function estimatedValue(text: string) {
  const match = text.match(MONEY);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  const scaled = match[2] ? amount * 1_000_000 : amount;
  if (scaled < 1000 || scaled > 999_999_999_999) return null;
  return Math.round(scaled * 100) / 100;
}

export function scopeSummary(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

export function publicPartyName(value: string) {
  const text = value.trim();
  if (!text || /not stored|data protection|available in the source|^see source$/i.test(text)) return null;
  return text.slice(0, 200);
}
