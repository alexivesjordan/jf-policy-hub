export type OrgHolder = { id: string; name: string };
export type OrgPosition = {
  id: string;
  title: string;
  reports_to: string | null;
  holders: OrgHolder[];
};
export type OrgPerson = {
  id: string;
  name: string;
  position_id: string | null;
  company: string | null;
  lead: string | null;
  manager: string | null;
  director: boolean;
};

export function seatLabel(holders: OrgHolder[]) {
  if (holders.length === 0) return "VACANT";
  return holders.map((holder) => holder.name).join(", ");
}

export function positionRows(positions: OrgPosition[]) {
  const byParent = new Map<string | null, OrgPosition[]>();
  for (const position of positions) {
    const key = position.reports_to;
    byParent.set(key, [...(byParent.get(key) ?? []), position]);
  }
  const rows: { position: OrgPosition; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const position of byParent.get(parent) ?? []) {
      rows.push({ position, depth });
      walk(position.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}
