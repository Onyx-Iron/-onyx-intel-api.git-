interface StatusBadgeProps {
  status: string;
}

const STATUS_STYLES: Record<string, string> = {
  active:    "bg-emerald-900/60 text-emerald-400 border-emerald-800/40",
  bidding:   "bg-blue-900/60 text-blue-400 border-blue-800/40",
  complete:  "bg-gray-800 text-gray-400 border-gray-700",
  on_hold:   "bg-yellow-900/60 text-yellow-400 border-yellow-800/40",
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] ?? "bg-gray-800 text-gray-400 border-gray-700";
  return (
    <span
      className={`inline-block text-xs px-2 py-0.5 rounded border capitalize ${style}`}
      aria-label={`Status: ${status.replace("_", " ")}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}
