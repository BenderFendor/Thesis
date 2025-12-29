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
    <Card className="p-4 space-y-4 border border-border/60 bg-[var(--news-bg-secondary)]/80">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            Reading Digest
          </div>
          <div className="mt-1 flex items-center gap-2">
            <BookMarked className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-base text-foreground">
              Daily Digest
            </h3>
          </div>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {digest.digest_items.length} items
        </span>
      </div>

      <div className="space-y-2">
        {digest.digest_items.length > 0 ? (
          digest.digest_items.slice(0, 3).map((item) => (
            <Link
              key={item.id}
              href={`/reader/${item.id}`}
              className="block rounded-md border border-border/50 bg-background/40 px-3 py-2 hover:border-primary/50"
            >
              <div className="text-sm font-medium text-foreground truncate">
                {item.article_title}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {item.article_source}
              </div>
            </Link>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            No articles in digest today
          </p>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground rounded-md border border-border/40 bg-background/30 px-3 py-2">
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          <span>{digest.estimated_read_time_minutes} min read</span>
        </div>
        <div className="flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          <span>{digest.total_items} total items</span>
        </div>
      </div>

      <div className="pt-3 border-t border-border/60">
        {showSchedule ? (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Daily digest time
            </label>
            <div className="flex gap-2">
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="flex-1 px-2 py-1 text-xs rounded border border-border/60 bg-background text-foreground"
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
            Schedule digest
          </Button>
        )}
      </div>
    </Card>
  );
}
