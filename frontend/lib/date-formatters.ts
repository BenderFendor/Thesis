import { hasText } from "@/lib/utils";
const ARTICLE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const ARTICLE_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  year: "numeric",
});

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
});

const MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
});

const formatDate = (value: string | null | undefined, formatter: Intl.DateTimeFormat): string => {
  if (!hasText(value)) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
  return value;
}
return formatter.format(date);
};

const formatArticleDate = (value?: string | null): string =>
  formatDate(value, ARTICLE_DATE_FORMATTER);

const formatArticleDateTime = (value?: string | null): string =>
  formatDate(value, ARTICLE_DATE_TIME_FORMATTER);

const formatShortDate = (value?: string | null): string =>
  formatDate(value, SHORT_DATE_FORMATTER);

const formatMonthYear = (value?: string | null): string =>
  formatDate(value, MONTH_YEAR_FORMATTER);
export { formatArticleDate, formatArticleDateTime, formatShortDate, formatMonthYear };
