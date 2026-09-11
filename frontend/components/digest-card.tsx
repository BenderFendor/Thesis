"use client";

import { BookMarked, Calendar, Clock } from "lucide-react";
import { ENABLE_DIGEST, getDailyDigest } from "@/lib/api";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import Link from "next/link";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

type DigestItem = Awaited<ReturnType<typeof getDailyDigest>>["digest_items"][number];

interface DigestData {
  readonly digest_items: readonly Readonly<DigestItem>[];
  readonly total_items: number;
  readonly estimated_read_time_minutes: number;
  readonly generated_at: string;
}

interface DigestCardProps {
  readonly enabled?: boolean;
}

interface DigestItemsProps {
  readonly items: readonly Readonly<DigestItem>[];
}

interface DigestSummaryProps {
  readonly digest: DigestData;
}

interface DigestHeaderProps {
  readonly digest: DigestData;
}

interface TimeInputChangeEvent {
  readonly target: Readonly<{ readonly value: string }>;
}

interface DigestScheduleFormProps {
  readonly onChange: (event: Readonly<TimeInputChangeEvent>) => void;
  readonly onSchedule: () => void;
  readonly scheduleTime: string;
}

const DIGEST_PREVIEW_LIMIT = 3,
 DigestCard = ({ enabled = ENABLE_DIGEST }: Readonly<DigestCardProps>) => {
  const { data: digest, isLoading } = useQuery<DigestData>({
    enabled,
    queryFn: getDailyDigest,
    queryKey: ["daily-digest"],
    retry: QUERY_RETRY_COUNT,
  });

  if (!enabled || isLoading || !digest) {
    return false;
  }

  return (
    <Card className="p-4 space-y-4 border border-border/60 bg-[var(--news-bg-secondary)]/80">
      <DigestHeader digest={digest} />
      <DigestItems items={digest.digest_items} />
      <DigestSummary digest={digest} />
      <div className="pt-3 border-t border-border/60">
        <DigestSchedule />
      </div>
    </Card>
  );
},

 DigestHeader = ({ digest }: Readonly<DigestHeaderProps>) => (
  <div className="flex items-start justify-between gap-3">
    <div className="space-y-1">
      <DigestTitle />
    </div>
    <span className="text-[11px] text-muted-foreground">{digest.digest_items.length} items</span>
  </div>
),

 DigestItems = ({ items }: Readonly<DigestItemsProps>) => {
  if (items.length === EMPTY_DIGEST_COUNT) {
    return <p className="text-sm text-muted-foreground">No articles in digest today</p>;
  }

  return (
    <div className="space-y-2">
      {items.slice(EMPTY_DIGEST_COUNT, DIGEST_PREVIEW_LIMIT).map((item) => (
        <Link
          key={item.id}
          href={item.article_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-md border border-border/50 bg-background/40 px-3 py-2 hover:border-primary/50"
        >
          <div className="text-sm font-medium text-foreground truncate">{item.article_title}</div>
          <div className="text-[11px] text-muted-foreground">{item.article_source}</div>
        </Link>
      ))}
    </div>
  );
},

 DigestSchedule = () => {
  const [showSchedule, setShowSchedule] = useState(false),
   [scheduleTime, setScheduleTime] = useState("09:00"),
   handleSchedule = useCallback(() => {
    toast.success(`Digest scheduled for ${scheduleTime} daily`);
    localStorage.setItem("digestScheduleTime", scheduleTime);
    setShowSchedule(false);
  }, [scheduleTime]),
   handleScheduleTimeChange = useCallback((event: Readonly<TimeInputChangeEvent>) => {
    setScheduleTime(event.target.value);
  }, [setScheduleTime]),
   openSchedule = useCallback(() => {
    setShowSchedule(true);
  }, []);

  if (showSchedule) {
    return <DigestScheduleForm onChange={handleScheduleTimeChange} onSchedule={handleSchedule} scheduleTime={scheduleTime} />;
  }

  return (
    <Button variant="outline" size="sm" onClick={openSchedule} className="w-full text-xs">
      <Calendar className="h-3 w-3 mr-1" />
      Schedule digest
    </Button>
  );
},

 DigestScheduleForm = ({ onChange, onSchedule, scheduleTime }: Readonly<DigestScheduleFormProps>) => (
  <div className="space-y-2">
    <label htmlFor="digest-schedule-time" className="block text-xs font-medium text-muted-foreground">
      Daily digest time
    </label>
    <div className="flex gap-2">
      <input
        id="digest-schedule-time"
        type="time"
        value={scheduleTime}
        onChange={onChange}
        className="flex-1 px-2 py-1 text-xs rounded border border-border/60 bg-background text-foreground"
      />
      <Button size="sm" onClick={onSchedule} className="text-xs h-auto py-1">
        Set
      </Button>
    </div>
  </div>
),

 DigestSummary = ({ digest }: Readonly<DigestSummaryProps>) => (
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
),

 DigestTitle = () => (
  <>
    <span className="block text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
      Reading Digest
    </span>
    <h3 className="flex items-center gap-2 font-semibold text-base text-foreground">
      <BookMarked className="h-4 w-4 text-primary" />
      Daily Digest
    </h3>
  </>
),

 EMPTY_DIGEST_COUNT = 0,
 QUERY_RETRY_COUNT = 1;

export { DigestCard };
