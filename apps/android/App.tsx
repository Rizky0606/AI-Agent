import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './src/hooks/use-queries.ts';
import { AppNavigator } from './src/navigation/Navigator.tsx';

export default function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <AppNavigator />
    </QueryClientProvider>
  );
}
