import { redirect } from "next/navigation";

export default function PeopleAdminRedirectPage() {
  redirect("/workspace/users");
}
