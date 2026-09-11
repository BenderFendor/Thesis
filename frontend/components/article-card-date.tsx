import { Clock } from "lucide-react";
import { formatShortDate } from "@/lib/date-formatters";

interface ArticleCardDateProps {
  readonly date: string;
  readonly className?: string;
}

const ArticleCardDate = ({ className, date }: ArticleCardDateProps) => (
  <span className={`inline-flex items-center gap-1 ${className ?? ""}`}>
    <Clock className="h-3 w-3" aria-hidden="true" />
    <span>{formatShortDate(date)}</span>
  </span>
);

export { ArticleCardDate };
