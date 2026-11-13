/**
 * Rows taken from the approved-subcontractor sheet.
 * Insurance files are not included: the links need a Monday.com login.
 * Emails are copied as written, including the two known-bad addresses.
 */
export type SeedSubcontractor = {
  id: string;
  name: string;
  contactName: string;
  phone: string | null;
  email: string | null;
  status: "preferred" | "on_hold";
  notes: string | null;
  regions: string[];
  jobTypes: string[];
  maxCrew: number | null;
};

export const SEEDED_SUBCONTRACTORS: SeedSubcontractor[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Amazon Leisure",
    contactName: "Sarah Forder",
    phone: "07834 753160",
    email: "sarah@amazon-leisure",
    status: "preferred",
    notes: "Can undertake any install type",
    regions: [],
    jobTypes: ["install", "flooring"],
    maxCrew: null,
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Taylor Made Fitness Solutions",
    contactName: "Danny Taylor",
    phone: "07538 518195",
    email: "danny.taylor@tm-fs.com",
    status: "on_hold",
    notes: "Can do up to 4 man installs",
    regions: [],
    jobTypes: ["install"],
    maxCrew: 4,
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    name: "Draig Fitness",
    contactName: "Chris Stevens",
    phone: "07799325318",
    email: "chris@draigfitness.com",
    status: "preferred",
    notes: "Not used often.",
    regions: [],
    jobTypes: ["install"],
    maxCrew: null,
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    name: "Eamon o'Conner",
    contactName: "Eamon o'Conner",
    phone: "+353 87 678 7150",
    email: "ocmsirl@gmail.com",
    status: "on_hold",
    notes: "Ireland only.",
    regions: ["Ireland"],
    jobTypes: ["install"],
    maxCrew: null,
  },
  {
    id: "10000000-0000-4000-8000-000000000005",
    name: "Fitness Bricks",
    contactName: "Matt Leadbetter",
    phone: "07751 193799",
    email: "matt@fitnessbricks.co.uk",
    status: "on_hold",
    notes: "Tends to be expensive.",
    regions: [],
    jobTypes: ["install"],
    maxCrew: null,
  },
  {
    id: "10000000-0000-4000-8000-000000000006",
    name: "Globalise Fitness Solutions",
    contactName: "Reg Varney",
    phone: "07901 776557",
    email: "reg@gfs-ukltd.com",
    status: "on_hold",
    notes: "Covers west country. Good pricing and reliable.",
    regions: ["West Country"],
    jobTypes: ["install"],
    maxCrew: null,
  },
  {
    id: "10000000-0000-4000-8000-000000000007",
    name: "GRS",
    contactName: "Ady Dockerill",
    phone: "01353 862863",
    email: "adrian@gymrepairservices.co.uk",
    status: "preferred",
    notes: "Will not do flooring. Will pick and choose jobs.",
    regions: [],
    jobTypes: ["install"],
    maxCrew: null,
  },
  {
    id: "10000000-0000-4000-8000-000000000008",
    name: "Power Leisure",
    contactName: "Darren Bell",
    phone: "07887 781791",
    email: "service@poerleisure.info",
    status: "preferred",
    notes: "Based in Scotland but covers UK. Prices good, especially in Scotland.",
    regions: ["Scotland", "UK"],
    jobTypes: ["install"],
    maxCrew: null,
  },
  {
    id: "10000000-0000-4000-8000-000000000009",
    name: "Trigon",
    contactName: "Joe Riley",
    phone: "01420 579048",
    email: "joe@trigonfitness.com",
    status: "on_hold",
    notes: "Very reliable.",
    regions: [],
    jobTypes: ["install"],
    maxCrew: null,
  },
  {
    id: "10000000-0000-4000-8000-00000000000a",
    name: "FitKit",
    contactName: "Scott Lamber",
    phone: "07539301039",
    email: "scott.lamber@fitkituk.com",
    status: "preferred",
    notes: "Can be expesive.",
    regions: [],
    jobTypes: ["install"],
    maxCrew: null,
  },
  {
    id: "10000000-0000-4000-8000-00000000000b",
    name: "Gym Logistics",
    contactName: "Geoff",
    phone: null,
    email: "info@gymlogistics.co.uk",
    status: "preferred",
    notes: null,
    regions: [],
    jobTypes: ["install"],
    maxCrew: null,
  },
];

/** Addresses copied from the sheet that Alex still needs to correct. */
export const CHECK_EMAILS = ["sarah@amazon-leisure", "service@poerleisure.info"] as const;
