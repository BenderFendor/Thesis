"use client";

import { useReadingQueue } from "@/hooks/useReadingQueue";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { List, X } from "lucide-react";

export function ReadingQueueSidebar() {
  const { queuedArticles, removeArticleFromQueue, isLoaded } =
    useReadingQueue();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full shadow-lg"
        >
          <List className="h-6 w-6" />
          {isLoaded && queuedArticles.length > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
              {queuedArticles.length}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[400px] sm:w-[540px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Reading Queue</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto pr-4">
          {isLoaded && queuedArticles.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground">Your queue is empty.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {queuedArticles.map((article) => (
                <li
                  key={article.url}
                  className="group flex items-start justify-between gap-2 rounded-md border p-3 hover:bg-accent"
                >
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1"
                  >
                    <p className="font-semibold leading-tight group-hover:underline">
                      {article.title}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {article.source}
                    </p>
                  </a>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => removeArticleFromQueue(article.url)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
