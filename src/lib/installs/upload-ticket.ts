export type StorageTicket = {
  bucket: "job-sheets" | "documents";
  path: string;
  token: string;
  signedUrl: string;
};
