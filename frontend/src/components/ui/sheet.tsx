import * as React from 'react'
import { Dialog as SheetPrimitive } from 'radix-ui'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

const Sheet = SheetPrimitive.Root
const SheetClose = SheetPrimitive.Close

function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0b1220]/30 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col overflow-y-auto border-l border-border bg-card shadow-[-24px_0_64px_rgb(11_18_32/0.16)] outline-none sm:max-w-[520px] data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=closed]:duration-200 data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=open]:duration-300',
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute top-5 right-5 grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <XIcon className="size-4" />
          <span className="sr-only">Cerrar</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}

const SheetTitle = SheetPrimitive.Title
const SheetDescription = SheetPrimitive.Description

export { Sheet, SheetClose, SheetContent, SheetTitle, SheetDescription }
