"use client";

import { useEffect, useState } from "react";
import { QueueOverview, getQueueOverview } from "@/lib/api";
import { Clock, FileText, CheckCircle, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";

export function QueueOverviewCard() {
  const [overview, setOverview] = useState<QueueOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOverview = async () => {
      try {
        setLoading(true);
        const data = await getQueueOverview();
        setOverview(data);
        setError(null);
      } catch (err) {
        console.error("Failed to load queue overview:", err);
        setError("Failed to load queue overview");
      } finally {
        setLoading(false);
      }
    };

    fetchOverview();
    // Refresh every 30 seconds
    const interval = setInterval(fetchOverview, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <Card className="p-4 bg-gray-50 dark:bg-gray-900">
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full" />
        </div>
      </Card>
    );
  }

  if (error || !overview) {
    return null;
  }

  return (
    <Card className="p-4 bg-gradient-to-br from-primary/10 to-amber-500/10 dark:from-gray-900 dark:to-gray-800 border-primary/30 dark:border-gray-700">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-serif font-bold text-lg">Queue Overview</h3>
          <FileText className="w-5 h-5 text-primary" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded p-3">
            <p className="text-xs text-gray-600 dark:text-gray-400">Unread</p>
            <p className="text-2xl font-bold">{overview.unread_count}</p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded p-3">
            <p className="text-xs text-gray-600 dark:text-gray-400">Completed</p>
            <p className="text-2xl font-bold text-green-600">
              {overview.completed_count}
            </p>
          </div>

          <div className="col-span-2 bg-white dark:bg-gray-800 rounded p-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-orange-600 dark:text-orange-400" />
              <div>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Est. Read Time
                </p>
                <p className="text-lg font-semibold">
                  {overview.estimated_total_read_time_minutes} mins
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="text-xs text-gray-600 dark:text-gray-400 pt-2 border-t border-gray-200 dark:border-gray-700">
          <p>Daily: {overview.daily_items} • Permanent: {overview.permanent_items}</p>
        </div>
      </div>
    </Card>
  );
}
