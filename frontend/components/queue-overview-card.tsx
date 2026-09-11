"use client";

import { Clock, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { QueueOverview } from "@/lib/api";
import { getQueueOverview } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

interface QueueStatProps {
  readonly label: string;
  readonly value: number;
  readonly valueClassName?: string;
}

interface QueueReadTimeProps {
  readonly value: number;
}

const QueueOverviewCard = () => {
  const {
    data: overview,
    isLoading: loading,
    error,
  } = useQuery<QueueOverview>({
    queryFn: getQueueOverview,
    queryKey: ["queue-overview"],
    refetchInterval: 30_000,
    retry: 1,
  });

  if (loading) {
    return <QueueOverviewLoading />;
  }

  if (error || overview === undefined) {
    return false;
  }

  return <QueueOverviewContent overview={overview} />;
},

 QueueOverviewContent = ({ overview }: Readonly<{ overview: Readonly<QueueOverview> }>) => (
  <Card className="space-y-3 p-4 bg-gradient-to-br from-primary/10 to-amber-500/10 dark:from-gray-900 dark:to-gray-800 border-primary/30 dark:border-gray-700">
    <QueueOverviewHeader />
    <QueueOverviewStats overview={overview} />
    <QueueOverviewSummary overview={overview} />
  </Card>
),

 QueueOverviewHeader = () => (
  <div className="flex items-center justify-between">
    <h3 className="font-serif font-bold text-lg">Queue Overview</h3>
    <FileText className="w-5 h-5 text-primary" />
  </div>
),

 QueueOverviewLoading = () => (
  <Card className="p-4 bg-gray-50 dark:bg-gray-900">
    <div className="animate-pulse space-y-2">
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full" />
    </div>
  </Card>
),

 QueueOverviewStats = ({ overview }: Readonly<{ overview: Readonly<QueueOverview> }>) => (
  <div className="grid grid-cols-2 gap-3">
    <QueueStat label="Unread" value={overview.unread_count} />
    <QueueStat label="Completed" value={overview.completed_count} valueClassName="text-green-600" />
    <QueueReadTime value={overview.estimated_total_read_time_minutes} />
  </div>
),

 QueueOverviewSummary = ({ overview }: Readonly<{ overview: Readonly<QueueOverview> }>) => (
  <div className="text-xs text-gray-600 dark:text-gray-400 pt-2 border-t border-gray-200 dark:border-gray-700">
    <p>Daily: {overview.daily_items} • Permanent: {overview.permanent_items}</p>
  </div>
),

 QueueReadTime = ({ value }: Readonly<QueueReadTimeProps>) => (
  <div className="col-span-2 bg-white dark:bg-gray-800 rounded p-3">
    <div className="flex items-center gap-2">
      <Clock className="w-4 h-4 text-orange-600 dark:text-orange-400" />
      <QueueReadTimeValue value={value} />
    </div>
  </div>
),

 QueueReadTimeValue = ({ value }: Readonly<QueueReadTimeProps>) => (
  <div>
    <p className="text-xs text-gray-600 dark:text-gray-400">Est. Read Time</p>
    <p className="text-lg font-semibold">{value} mins</p>
  </div>
),

 QueueStat = ({ label, value, valueClassName }: Readonly<QueueStatProps>) => (
  <div className="bg-white dark:bg-gray-800 rounded p-3">
    <p className="text-xs text-gray-600 dark:text-gray-400">{label}</p>
    <p className={`text-2xl font-bold ${valueClassName ?? ""}`}>{value}</p>
  </div>
);

export { QueueOverviewCard };
