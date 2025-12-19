"use client";

import { useEffect, useState } from "react";
import { getDailyDigest, ENABLE_DIGEST, ReadingQueueItem } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookMarked, Calendar, Clock } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

interface DigestData {
  digest_items: ReadingQueueItem[];
  total_items: number;
  estimated_read_time_minutes: number;
  generated_at: string;
}

interface DigestCardProps {
  onRefresh?: () => void;
}

export function DigestCard({ onRefresh }: DigestCardProps) {
  if (!ENABLE_DIGEST) {
    return null;
  }

  const [digest, setDigest] = useState<DigestData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("09:00");

  useEffect(() => {
    const loadDigest = async () => {
      try {
        setIsLoading(true);
        const data = await getDailyDigest();
        setDigest(data);
      } catch (error) {
        console.error("Failed to load daily digest:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadDigest();
  }, []);

  const handleSchedule = () => {
    toast.success(`Digest scheduled for ${scheduleTime} daily`);
    localStorage.setItem("digestScheduleTime", scheduleTime);
    setShowSchedule(false);
  };

  if (isLoading || !digest) {
    return null;
  }

  return (
    <Card className="p-4 space-y-3 bg-gradient-to-br from-primary/10 to-amber-500/10 dark:from-gray-900 dark:to-gray-800 border-primary/30 dark:border-gray-700">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookMarked className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-gray-900 dark:text-white">
            Today's Digest
          </h3>
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {digest.digest_items.length} items
        </span>
      </div>

      {/* Digest Items Preview */}
      <div className="space-y-2">
        {digest.digest_items.length > 0 ? (
          digest.digest_items.slice(0, 3).map((item) => (
            <Link
              key={item.id}
              href={`/reader/${item.id}`}
              className="block p-2 bg-white dark:bg-slate-900 rounded-lg hover:bg-primary/10 dark:hover:bg-primary/20 transition-colors border border-primary/20 dark:border-primary/40"
            >
              <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {item.article_title}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {item.article_source}
              </div>
            </Link>
          ))
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No articles in digest today
          </p>
        )}
      </div>

      {/* Summary Stats */}
      <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 bg-white dark:bg-slate-900 rounded-lg p-2">
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          <span>{digest.estimated_read_time_minutes} min read</span>
        </div>
        <div className="flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          <span>{digest.total_items} total items</span>
        </div>
      </div>

      {/* Scheduling Section */}
      <div className="pt-2 border-t border-primary/30 dark:border-primary/40">
        {showSchedule ? (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
              Daily digest time:
            </label>
            <div className="flex gap-2">
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="flex-1 px-2 py-1 text-xs rounded border border-primary/30 dark:border-primary/50 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
              />
              <Button
                size="sm"
                onClick={handleSchedule}
                className="text-xs h-auto py-1"
              >
                Set
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSchedule(true)}
            className="w-full text-xs"
          >
            <Calendar className="h-3 w-3 mr-1" />
            Schedule Digest
          </Button>
        )}
      </div>
    </Card>
  );
}
