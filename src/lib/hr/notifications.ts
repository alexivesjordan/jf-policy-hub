export const HR_NOTICE_BODY = "Open HR Pulse to see it.";

export const HR_NOTICE_TITLES = [
  "Something needs your attention in HR Pulse",
  "A request needs your decision",
  "Your request has been decided",
] as const;

export type HrNoticeTitle = (typeof HR_NOTICE_TITLES)[number];

const TITLES: Record<"attention" | "decision" | "decided", HrNoticeTitle> = {
  attention: "Something needs your attention in HR Pulse",
  decision: "A request needs your decision",
  decided: "Your request has been decided",
};

export function hrNotice(purpose: keyof typeof TITLES, href: string) {
  return { title: TITLES[purpose], body: HR_NOTICE_BODY, link: href };
}

export function noticeLeaks(payload: { title: string; body: string; link: string | null }, secrets: string[]) {
  const blob = `${payload.title}\n${payload.body}\n${payload.link ?? ""}`.toLowerCase();
  return secrets.filter(Boolean).some((secret) => blob.includes(secret.toLowerCase()));
}
