import React from "react";

import { cn } from "@/lib/utils";

interface CardProps {
  readonly children?: React.ReactNode;
  readonly className?: string;
}

interface CardRootProps extends CardProps {
  readonly onClick?: () => void;
}

const Card: React.FC<CardRootProps> = ({ children, className, onClick }) => {
  const cardClassName = cn(
    "bg-card text-card-foreground flex flex-col gap-6 rounded-lg border shadow-sm",
    className,
  );

  if (onClick) {
    return (
      <button
        data-slot="card"
        className={cardClassName}
        onClick={onClick}
        type="button"
      >
        {children}
      </button>
    );
  }

  return (
    <div data-slot="card" className={cardClassName}>
      {children}
    </div>
  );
};

const CardHeader: React.FC<CardProps> = ({ children, className }) => (
  <div
    data-slot="card-header"
    className={cn(
      "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
      className,
    )}
  >
    {children}
  </div>
);

const CardTitle: React.FC<CardProps> = ({ children, className }) => (
  <div data-slot="card-title" className={cn("leading-none font-semibold", className)}>
    {children}
  </div>
);

const CardDescription: React.FC<CardProps> = ({ children, className }) => (
  <div
    data-slot="card-description"
    className={cn("text-muted-foreground text-sm", className)}
  >
    {children}
  </div>
);

const CardContent: React.FC<CardProps> = ({ children, className }) => (
  <div data-slot="card-content" className={cn("px-6", className)}>
    {children}
  </div>
);

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
