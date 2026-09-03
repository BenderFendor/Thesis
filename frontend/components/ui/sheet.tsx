'use client'

import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'

import { cn } from '@/lib/utils'

const Sheet = ({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Root>) => 
  <SheetPrimitive.Root data-slot="sheet" {...props} />


const SheetTrigger = ({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) => 
  <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />


const SheetClose = ({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) => 
  <SheetPrimitive.Close data-slot="sheet-close" {...props} />


const SheetPortal = ({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) => 
  <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />


const SheetOverlay = ({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) => 
  (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50',
        className,
      )}
      {...props}
    />
  )


const SheetContent = ({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content>) => 
  (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right fixed inset-y-0 right-0 z-50 flex flex-col bg-background sm:max-w-md border-l shadow-lg',
          className,
        )}
        {...props}
      />
    </SheetPortal>
  )


const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => 
  (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col space-y-2 text-center sm:text-left', className)}
      {...props}
    />
  )


const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => 
  (
    <div
      data-slot="sheet-footer"
      className={cn(
        'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
        className,
      )}
      {...props}
    />
  )


const SheetTitle = ({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) => 
  (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-lg font-semibold text-foreground', className)}
      {...props}
    />
  )


const SheetDescription = ({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) => 
  (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )


export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
