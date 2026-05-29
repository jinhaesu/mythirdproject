'use client';

import { forwardRef, ButtonHTMLAttributes, CSSProperties } from 'react';
import { clsx } from 'clsx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

/**
 * Linear-style button component.
 *
 * font-weight 590 is not a standard Tailwind step, so it is applied via an
 * inline style object that merges cleanly with any caller-provided `style`.
 *
 * Active state: scale(0.97) via Tailwind's `active:scale-[0.97]`.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading,
      disabled,
      style,
      children,
      ...props
    },
    ref
  ) => {
    // Base styles shared by every variant
    const baseStyles =
      'inline-flex items-center justify-center rounded-full ' +
      'transition-[background,transform] duration-[150ms,100ms] ease-[ease,ease] ' +
      'active:scale-[0.97] ' +
      'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#08090A] focus:ring-[#5E6AD2] ' +
      'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100';

    const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
      /**
       * Primary: indigo fill, hover lightens to #828FFF.
       * Box-shadow gives subtle depth without looking glossy.
       */
      primary:
        'bg-[#5E6AD2] hover:bg-[#828FFF] text-white border border-transparent ' +
        'shadow-[0px_4px_24px_rgba(0,0,0,0.20)]',

      /**
       * Secondary: nearly-invisible translucent surface with a fine white border.
       */
      secondary:
        'bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.07)] ' +
        'text-[#F7F8F8] border border-[rgba(255,255,255,0.08)]',

      /**
       * Outline maps to secondary styling — pill shape, subtle border.
       * Kept for API compatibility.
       */
      outline:
        'bg-transparent hover:bg-[rgba(255,255,255,0.07)] ' +
        'text-[#F7F8F8] border border-[#23252A]',

      /**
       * Ghost: fully transparent, only shows a muted fill on hover.
       */
      ghost:
        'bg-transparent hover:bg-[rgba(255,255,255,0.07)] ' +
        'text-[#F7F8F8] border border-transparent',

      /**
       * Danger: Linear red (#EB5757) for destructive actions.
       */
      danger:
        'bg-[#EB5757] hover:bg-[#F07070] text-white border border-transparent ' +
        'shadow-[0px_4px_24px_rgba(0,0,0,0.20)]',
    };

    const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
      sm: 'min-h-[32px] px-[14px] text-[13px]',
      md: 'min-h-[40px] px-[18px] text-[14px]',
      lg: 'min-h-[48px] px-[24px] text-[15px]',
    };

    // font-weight 590 is not available as a Tailwind utility class — apply inline.
    const linearFontStyle: CSSProperties = { fontWeight: 590, ...style };

    return (
      <button
        ref={ref}
        className={clsx(baseStyles, variants[variant], sizes[size], className)}
        style={linearFontStyle}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
