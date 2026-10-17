'use client'

import * as React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type AppSelectOption = { value: string; label: React.ReactNode } | string

const EMPTY_SENTINEL = '__empty__'

function normalizeOption(opt: AppSelectOption): { value: string; label: React.ReactNode } {
  if (typeof opt === 'string') {
    return { value: opt || EMPTY_SENTINEL, label: opt || '\u00A0' }
  }
  return {
    value: opt.value === '' ? EMPTY_SENTINEL : opt.value,
    label: opt.label,
  }
}

function hasEmptyOption(options: AppSelectOption[]): boolean {
  return options.some((opt) => {
    const v = typeof opt === 'string' ? opt : opt.value
    return v === ''
  })
}

export interface AppSelectProps {
  value?: string
  onValueChange?: (value: string) => void
  options: AppSelectOption[]
  placeholder?: string
  disabled?: boolean
  size?: 'sm' | 'default'
  className?: string
  id?: string
  'aria-label'?: string
}

export function AppSelect({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  size = 'default',
  className,
  id,
  'aria-label': ariaLabel,
}: AppSelectProps) {
  const includesEmpty = hasEmptyOption(options)
  const normalizedOptions = options.map(normalizeOption)

  // Convert value for the Select primitive
  const selectValue = value === '' && includesEmpty ? EMPTY_SENTINEL : value

  const handleValueChange = (nextValue: string | null) => {
    if (!onValueChange || nextValue === null) return
    // Convert back empty sentinel to empty string
    if (nextValue === EMPTY_SENTINEL) {
      onValueChange('')
    } else {
      onValueChange(nextValue)
    }
  }

  return (
    <Select
      value={selectValue === '' || selectValue === undefined ? null : selectValue}
      onValueChange={handleValueChange}
      disabled={disabled}
      items={normalizedOptions}
    >
      <SelectTrigger
        id={id}
        size={size}
        className={cn('w-full', className)}
        aria-label={ariaLabel}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent size={size}>
        {normalizedOptions.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} size={size}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
