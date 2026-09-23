import React from "react";

import { cn } from "@/lib/utils";

interface TableProps {
  readonly children?: React.ReactNode;
  readonly className?: string;
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(({ children, className }, ref) => (
    <div className="relative w-full overflow-auto">
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)}>
        {children}
      </table>
    </div>
  ));
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, TableProps>(
  ({ children, className }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)}>
    {children}
  </thead>
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, TableProps>(
  ({ children, className }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)}>
    {children}
  </tbody>
));
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, TableProps>(
  ({ children, className }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
  >
    {children}
  </tfoot>
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, TableProps>(({ children, className }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
    >
      {children}
    </tr>
  ));
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, TableProps>(
  ({ children, className }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
      className,
    )}
  >
    {children}
  </th>
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, TableProps>(
  ({ children, className }, ref) => (
  <td ref={ref} className={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0", className)}>
    {children}
  </td>
));
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, TableProps>(
  ({ children, className }, ref) => (
  <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)}>
    {children}
  </caption>
));
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableCaption };
