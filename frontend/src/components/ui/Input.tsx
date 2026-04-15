'use client';

import { forwardRef, InputHTMLAttributes } from 'react';
import { clsx } from 'clsx';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

/**
 * Linear-style text input.
 *
 * Surface:   bg #141516, border #23252A
 * Text:      #F7F8F8
 * Placeholder: #62666D  (quaternary text token)
 * Focus:     border and ring color #5E6AD2 (indigo brand)
 * Error:     border and ring color #EB5757 (Linear red)
 * Shape:     rounded-xl  (12px, matching Linear's --radius-12 token)
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, leftIcon, rightIcon, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label
            className="block mb-1 text-[13px] text-[#D0D6E0] tracking-[-0.01em]"
            style={{ fontWeight: 510 }}
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#62666D]">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            className={clsx(
              // Base surface
              'block w-full rounded-xl border bg-[#141516] text-[#F7F8F8]',
              'text-[14px] tracking-[-0.013em]',
              'min-h-[40px] px-3',
              // Placeholder color via Tailwind placeholder utility
              'placeholder-[#62666D]',
              // Default border
              'border-[#23252A]',
              // Focus: indigo ring (1px inner glow matches Linear's spec)
              'focus:outline-none focus:border-[#5E6AD2] focus:ring-1 focus:ring-[#5E6AD2]',
              // Disabled state
              'disabled:opacity-50 disabled:cursor-not-allowed',
              // Icon padding adjustments
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
              // Error override
              error && 'border-[#EB5757] focus:border-[#EB5757] focus:ring-[#EB5757]',
              className
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#62666D]">
              {rightIcon}
            </div>
          )}
        </div>
        {error && (
          <p className="mt-1 text-[13px] text-[#EB5757] tracking-[-0.01em]">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
