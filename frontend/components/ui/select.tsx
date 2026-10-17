"use client"

import * as React from "react"
import { Check, ChevronDown, ChevronUp } from "lucide-react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1.5 p-1", className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-left", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-2xl border border-transparent bg-input/50 whitespace-nowrap transition-[color,box-shadow] duration-200 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=default]:gap-1.5 data-[size=default]:px-3 data-[size=default]:py-2 data-[size=default]:text-sm data-[size=sm]:h-7 data-[size=sm]:gap-1 data-[size=sm]:rounded-xl data-[size=sm]:px-2 data-[size=sm]:py-1 data-[size=sm]:text-xs *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 data-[size=default]:[&_svg:not([class*='size-'])]:size-4 data-[size=sm]:[&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDown
            className={cn(
              "pointer-events-none text-muted-foreground",
              size === "sm" ? "size-3.5" : "size-4",
            )}
          />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  size = "default",
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  > & {
    size?: "sm" | "default"
  }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-size={size}
          data-align-trigger={alignItemWithTrigger}
          className={cn(
            "cn-menu-target cn-menu-translucent relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-2xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/5 duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            size === "sm" && "min-w-28 rounded-xl text-xs",
            className
          )}
          {...props}
        >
          <SelectScrollUpButton size={size} />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton size={size} />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-2 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  size = "default",
  ...props
}: SelectPrimitive.Item.Props & {
  size?: "sm" | "default"
}) {
  const compact = size === "sm"
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      data-size={size}
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        compact
          ? "min-h-6 gap-1.5 rounded-lg py-1 pr-6 pl-1.5 text-xs [&_svg:not([class*='size-'])]:size-3"
          : "min-h-7 rounded-xl py-1.5 pr-8 pl-2 text-sm [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span
            className={cn(
              "pointer-events-none absolute right-2 flex items-center justify-center",
              compact ? "size-3" : "size-4",
            )}
          />
        }
      >
        <Check className={cn("pointer-events-none", compact ? "size-3" : "size-4")} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1",
        size === "sm"
          ? "[&_svg:not([class*='size-'])]:size-3"
          : "[&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUp className={size === "sm" ? "size-3" : "size-4"} />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1",
        size === "sm"
          ? "[&_svg:not([class*='size-'])]:size-3"
          : "[&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDown className={size === "sm" ? "size-3" : "size-4"} />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
