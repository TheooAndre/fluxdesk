import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.ts';

export function useWatchlist(enabled = true) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['watchlist'],
    queryFn: ({ signal }) => api.watchlist(signal),
    enabled,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: false,
  });
  const change = useMutation({
    mutationFn: ({ id, add }: { id: string; add: boolean }) => api.changeWatchlist(id, add),
    onMutate: () => client.cancelQueries({ queryKey: ['watchlist'] }),
    onSuccess: (value) => client.setQueryData(['watchlist'], value),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['watchlist'] });
    },
  });
  return { query, change, assetIds: query.data?.assetIds ?? [] };
}
