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
            background: '#1C1C1F',
            color: '#F7F8F8',
            border: '1px solid #34343A',
            borderRadius: '8px',
            fontSize: '14px',
            boxShadow: '0px 7px 32px rgba(0, 0, 0, 0.35)',
          },
          success: {
            style: {
              background: '#1C1C1F',
              color: '#F7F8F8',
              border: '1px solid #27A644',
            },
            iconTheme: {
              primary: '#27A644',
              secondary: '#1C1C1F',
            },
          },
          error: {
            style: {
              background: '#1C1C1F',
              color: '#F7F8F8',
              border: '1px solid #EB5757',
            },
            iconTheme: {
              primary: '#EB5757',
              secondary: '#1C1C1F',
            },
          },
        }}
      />
    </QueryClientProvider>
  );
}
