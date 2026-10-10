import { Inbox } from "lucide-react";

export function EmptyState({ text = "Belum ada data" }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <Inbox className="h-8 w-8 text-gray-400 dark:text-gray-500" />
      <p className="text-sm text-gray-600 dark:text-gray-400">{text}</p>
    </div>
  );
}
