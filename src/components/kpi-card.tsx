import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function KpiCard({
  label,
  value,
  icon: Icon,
  className,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-gray-200 bg-card p-4 sm:p-6 dark:border-zinc-700", className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{label}</span>
        <Icon className="h-5 w-5 text-gray-400 dark:text-gray-500" />
      </div>
      <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-50">{value}</p>
    </div>
  );
}
