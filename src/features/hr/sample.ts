export const sampleHome = {
  name: "Quinn Ellis",
  allowance: { entitlement: 20, taken: 4, booked: 2, left: 14 },
  pending: [
    { id: "leave-1", label: "12 May – 13 May", status: "Requested", href: "/people/time-off" },
    { id: "change-1", label: "Phone", status: "Pending", href: "/people/me" },
  ],
  waiting: [
    { id: "11111111-1111-4111-8111-111111111111", kind: "leave" as const, label: "Avery Quinn · time off", href: "/people/time-off" },
  ],
  manager: true,
  director: true,
  mfaRequired: false,
  checklistScope: "all" as const,
  checklists: [
    { id: "chk-1", employeeId: "emp-avery", name: "Avery Quinn", kind: "onboarding", dueOn: "2026-12-14", openItems: 6 },
    { id: "chk-2", employeeId: "emp-blake", name: "Blake Morgan", kind: "offboarding", dueOn: "2026-12-18", openItems: 4 },
  ],
};

export const sampleMe = {
  preferredName: "Quinn",
  fullName: "Quinn Ellis",
  jobTitle: "Install engineer",
  department: "Operations",
  location: "Field",
  workEmail: "quinn.ellis@jordanfitness.com",
  phone: "07000 111222",
  personalEmail: "quinn.ellis@example.com",
  address: "1 Example Street, King's Lynn",
  startDate: "2024-05-01",
  contract: "Permanent",
  hours: "40",
  notice: "1 month",
  pay: "Annual",
  documents: [] as { id: string; kind: string }[],
  changes: [{ id: "change-1", field: "Phone", status: "Pending" }],
  leave: [{ id: "leave-1", label: "12 May – 13 May", status: "Requested", days: 2 }],
};

export const sampleTeam = [
  { id: "emp-avery", name: "Avery Quinn", role: "Warehouse", status: "In", initials: "AQ" },
  { id: "emp-blake", name: "Blake Morgan", role: "Install engineer", status: "Away", initials: "BM" },
];

export const samplePerson = {
  id: "emp-avery",
  name: "Avery Quinn",
  role: "Warehouse",
  department: "Warehouse",
  location: "Warehouse",
  email: "avery.quinn@jordanfitness.com",
  phone: "07000 333444",
  start: "2023-05-01",
  contract: "Permanent",
  hours: "40",
  notice: "1 month",
  pay: [{ id: "pay-1", from: "2025-05-01", basis: "Annual" }],
  rtw: [{ id: "rtw-1", type: "Passport", checked: "2025-06-01", expires: "2028-06-01" }],
  sickness: [{ id: "sick-1", from: "2026-02-02", to: "2026-02-03", status: "Closed" }],
  changes: [] as { id: string; field: string; status: string }[],
  review: false,
  status: "active",
  end: "",
  profileId: "11111111-1111-4111-8111-111111111111",
  engineerResourceId: "22222222-2222-4222-8222-222222222222",
  checklistAccess: "edit" as const,
  checklists: [
    {
      id: "chk-1",
      kind: "onboarding",
      status: "open",
      dueOn: "2026-12-14",
      items: [
        { id: "item-1", label: "Contract issued", owner: "hr", dueOn: "2026-11-30", doneAt: "2026-11-27T09:30:00Z", linkKind: "none" },
        { id: "item-2", label: "Pulse login invited", owner: "hr", dueOn: "2026-12-01", doneAt: null, linkKind: "pulse_invite" },
        { id: "item-3", label: "Engineer record", owner: "operations", dueOn: "2026-12-01", doneAt: null, linkKind: "engineer_record" },
      ],
    },
  ],
};

export const sampleCases = [
  { id: "case-1", title: "Flexible working", stage: "Requested", due: "2026-07-01" },
];

export const sampleCase = {
  id: "case-1",
  title: "Flexible working",
  stage: "Requested",
  stages: ["Requested", "Meeting", "Decided", "Appeal", "Closed"],
  due: "2026-07-01",
  members: ["Quinn Ellis", "Riley Hart"],
  entries: [
    { id: "e1", kind: "Stage", when: "1 May 2026", body: "Requested" },
    { id: "e2", kind: "Note", when: "2 May 2026", body: "Meeting offered. The person can be accompanied." },
  ],
};

export const sampleSettings = {
  leaveYear: "1 May",
  bankHolidayRule: "on_top" as const,
  allowance: 20,
  carryOver: 5,
  directors: ["Neil", "Deborah"],
  partners: [] as string[],
  inbound: false,
};
