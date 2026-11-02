import { redirect } from "next/navigation";

export const instant = false;

export default function PeopleRedirectPage() {
  redirect("/admin/users");
}
