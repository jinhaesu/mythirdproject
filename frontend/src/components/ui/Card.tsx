'use client';

import { HTMLAttributes, forwardRef } from 'react';
import { clsx } from 'clsx';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'bordered' | 'elevated';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

/**
 * Linear-style card/panel component.
 *
 * Variant mapping:
 *   default   → bg #0F1011, border #23252A  (main panel surface)
 *   bordered  → same as default (border is always present in Linear panels)
 *   elevated  → bg #1C1C1F, border #34343A  (secondary / stronger container)
 *
 * All variants share the same medium shadow token from the Linear spec:
 *   0px 3px 12px rgba(0,0,0,0.09)
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', padding = 'md', children, ...props }, ref) => {
    const variants: Record<NonNullable<CardProps['variant']>, string> = {
      default:
        'bg-[#0F1011] border border-[#23252A] text-[#F7F8F8] ' +
        'shadow-[0px_3px_12px_rgba(0,0,0,0.09)]',

      // bordered keeps the same surface as default — border is always visible
      bordered:
        'bg-[#0F1011] border border-[#23252A] text-[#F7F8F8] ' +
        'shadow-[0px_3px_12px_rgba(0,0,0,0.09)]',

      // elevated: one step up in the Linear surface hierarchy
      elevated:
        'bg-[#1C1C1F] border border-[#34343A] text-[#F7F8F8] ' +
        'shadow-[0px_3px_12px_rgba(0,0,0,0.09)]',
    };

    const paddings: Record<NonNullable<CardProps['padding']>, string> = {
      none: '',
      sm: 'p-3',
      md: 'p-4',
      lg: 'p-6',
    };

    return (
      <div
        ref={ref}
        className={clsx('rounded-2xl', variants[variant], paddings[padding], className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

/**
 * Divides the card header section from the body with a subtle Linear-spec border.
 */
export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={clsx('pb-4 border-b border-[#23252A]', className)}
      {...props}
    />
  )
);

CardHeader.displayName = 'CardHeader';

/**
 * Card title — 24px / weight 590 to match Linear's card title type token.
 * font-weight 590 applied inline since Tailwind has no utility for it.
 */
export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, style, ...props }, ref) => (
    <h3
      ref={ref}
      className={clsx('text-2xl tracking-[-0.012em] text-[#F7F8F8]', className)}
      style={{ fontWeight: 590, ...style }}
      {...props}
    />
  )
);

CardTitle.displayName = 'CardTitle';

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={clsx('pt-4', className)} {...props} />
  )
);

CardContent.displayName = 'CardContent';
