import { requireUser } from "@/lib/api-helpers";
import { AppShell } from "@/components/layout/app-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return <AppShell nama={user.nama}>{children}</AppShell>;
}
