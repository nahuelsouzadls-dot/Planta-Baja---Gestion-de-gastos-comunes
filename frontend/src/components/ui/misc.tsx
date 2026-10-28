import * as React from 'react'
import { Tabs as TabsPrimitive, Tooltip as TooltipPrimitive, Popover as PopoverPrimitive, Checkbox as CheckboxPrimitive } from 'radix-ui'
import { CheckIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

// ── Pestañas (subrayado, como el diseño aprobado) ──────────────────────
const Tabs = TabsPrimitive.Root

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('flex gap-5 overflow-x-auto border-b sm:gap-6 border-line [scrollbar-width:none]', className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative flex items-center gap-2 py-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground data-[state=active]:text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:scale-x-0 after:rounded-full after:bg-foreground after:transition-transform after:duration-200 data-[state=active]:after:scale-x-100 focus-visible:outline-none focus-visible:after:bg-acc",
        className,
      )}
      {...props}
    />
  )
}

const TabsContent = TabsPrimitive.Content

// ── Contador (badge numérico de pestañas y menús) ──────────────────────
function Count({ n, className }: { n: number; className?: string }) {
  if (!n) return null
  return (
    <span
      className={cn(
        'num inline-grid h-5 min-w-5 place-items-center rounded-full bg-foreground px-1.5 text-[11px] leading-none font-semibold text-white',
        className,
      )}
    >
      {n}
    </span>
  )
}

// ── Tooltip ────────────────────────────────────────────────────────────
function Tooltip({ content, children, side = 'right' }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className="z-50 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-white shadow-md animate-in fade-in-0 zoom-in-95"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
const TooltipProvider = TooltipPrimitive.Provider

// ── Popover ────────────────────────────────────────────────────────────
const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger

function PopoverContent({ className, align = 'end', sideOffset = 8, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-[0_16px_48px_rgb(11_18_32/0.16)] outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97]',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

// ── Checkbox ───────────────────────────────────────────────────────────
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer grid size-[18px] shrink-0 place-items-center rounded-[5px] border border-input bg-card transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-acc-soft2 data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-white',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <CheckIcon className="size-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

// ── Esqueleto de carga ─────────────────────────────────────────────────
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('animate-pulse rounded-md bg-[#e9ecf0]', className)} {...props} />
}

// ── Chips de filtro (seleccionado: negro con letra blanca, DISENO.md) ──
function Chip({ active, className, ...props }: React.ComponentProps<'button'> & { active?: boolean }) {
  return (
    <button
      type="button"
      data-slot="chip"
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-ink-2 transition-colors hover:bg-foreground hover:text-white',
        active && 'bg-foreground text-white',
        className,
      )}
      {...props}
    />
  )
}

export {
  Tabs, TabsList, TabsTrigger, TabsContent, Count,
  Tooltip, TooltipProvider, Popover, PopoverTrigger, PopoverContent,
  Checkbox, Skeleton, Chip,
}
