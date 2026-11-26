import { redirect } from "next/navigation";

export default function PeopleAdminRedirectPage() {
  redirect("/settings/workspace/users");
}
