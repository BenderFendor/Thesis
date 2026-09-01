import type { ComponentProps, FunctionComponent } from 'react'

import { cn } from '@/lib/utils'

interface InputProps {
  readonly 'aria-label'?: string
  readonly className?: string
  readonly disabled?: boolean
  readonly onChange?: ComponentProps<'input'>['onChange']
  readonly onKeyDown?: ComponentProps<'input'>['onKeyDown']
  readonly placeholder?: string
  readonly type?: string
  readonly value?: number | readonly string[] | string
}

const Input: FunctionComponent<Readonly<InputProps>> = (props) => {
  const {
    className,
    type,
    'aria-label': ariaLabel,
    disabled,
    onChange,
    onKeyDown,
    placeholder,
    value,
  } = props;

  return (
    <input
      aria-label={ariaLabel}
      className={cn(
        'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
        className,
      )}
      data-slot="input"
      disabled={disabled}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      type={type}
      value={value}
    />
  );
};


export { Input }
