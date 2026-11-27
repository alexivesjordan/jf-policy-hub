export type StaffPhoto = {
  id: string;
  caption: string | null;
  visible: boolean;
  sortOrder: number;
  url: string | null;
};

export type StaffLink = {
  id: string;
  orderNumber: string;
  status: "active" | "expired" | "revoked";
  createdAt: string;
  expiresOn: string;
  viewCount: number;
  lastViewedAt: string | null;
  photos: StaffPhoto[];
};
