'use client';

import { forwardRef, SelectHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

/**
 * Linear-style select input. Shares the same dark surface as Input:
 *
 * Surface:     bg #141516, border #23252A
 * Text:        #F7F8F8
 * Focus:       border and ring #5E6AD2
 * Error:       border and ring #EB5757
 * Shape:       rounded-xl
 * Chevron:     #62666D (quaternary text color)
 *
 * The native <select> element is used for full accessibility compliance.
 * `appearance-none` removes the OS chrome; the custom ChevronDown icon
 * replaces it, matching Linear's own compact icon style.
 *
 * Note: option elements inherit the OS default background on most platforms.
 * Setting `background: #141516` on option keeps it dark in browsers that
 * support it (Chrome, Edge, Firefox on Windows).
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, options, ...props }, ref) => {
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
          <select
            ref={ref}
            className={clsx(
              // Base surface — identical to Input
              'block w-full appearance-none rounded-xl border bg-[#141516] text-[#F7F8F8]',
              'text-[14px] tracking-[-0.013em]',
              'min-h-[40px] px-3 pr-10',
              // Default border
              'border-[#23252A]',
              // Focus: indigo ring
              'focus:outline-none focus:border-[#5E6AD2] focus:ring-1 focus:ring-[#5E6AD2]',
              // Disabled state
              'disabled:opacity-50 disabled:cursor-not-allowed',
              // Error override
              error && 'border-[#EB5757] focus:border-[#EB5757] focus:ring-[#EB5757]',
              className
            )}
            {...props}
          >
            {options.map((option) => (
              // Inline background keeps options visually consistent in
              // browsers that support styled <option> elements.
              <option
                key={option.value}
                value={option.value}
                style={{ background: '#141516', color: '#F7F8F8' }}
              >
                {option.label}
              </option>
            ))}
          </select>

          {/* Custom chevron replaces the native dropdown arrow */}
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-[#62666D]">
            <ChevronDown size={16} />
          </div>
        </div>

        {error && (
          <p className="mt-1 text-[13px] text-[#EB5757] tracking-[-0.01em]">{error}</p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';
