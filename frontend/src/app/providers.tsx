'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'react-hot-toast';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 3 * 60 * 60 * 1000, // 3 hours
            gcTime: 3 * 60 * 60 * 1000, // keep cache for 3 hours
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border-secondary)',
            borderRadius: '8px',
            fontSize: '14px',
            boxShadow: '0px 7px 32px rgba(0, 0, 0, 0.35)',
          },
          success: {
            style: {
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-green)',
            },
            iconTheme: {
              primary: 'var(--color-green)',
              secondary: 'var(--color-bg-secondary)',
            },
          },
          error: {
            style: {
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-red)',
            },
            iconTheme: {
              primary: 'var(--color-red)',
              secondary: 'var(--color-bg-secondary)',
            },
          },
        }}
      />
    </QueryClientProvider>
  );
}
