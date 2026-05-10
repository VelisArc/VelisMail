import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mail, auth } from '../api/client';
import { getApiBaseCandidates } from '../api/client';

export function useEmails(domain: string, folder: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!domain || !auth.isLoggedIn()) return;
    
    const apiBase = getApiBaseCandidates()[0] || '';
    if (!apiBase) return;
    
    // Convert http/https to ws/wss
    const wsUrl = apiBase.replace(/^http/, 'ws') + '/ws';
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      return;
    }
    
    ws.onmessage = (event) => {
      if (event.data === 'new_email' || event.data === 'connected') {
        // Invalidate emails query to trigger an instant refresh
        queryClient.invalidateQueries({ queryKey: ['emails', domain] });
      }
    };
    ws.onerror = () => {
      ws.close();
    };
    
    return () => {
      ws.close();
    };
  }, [domain, queryClient]);

  return useQuery({
    queryKey: ['emails', domain, folder],
    queryFn: () => mail.getBusinessByFolder(domain, folder),
    enabled: !!domain && !!auth.isLoggedIn(),
    refetchInterval: 60000, // Reduced to 60s since WS handles real-time updates
  });
}

export function useSendEmail() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (params: { domain: string, to: string[], subject: string, body: string, fromAddress?: string }) => 
      mail.sendBusiness(params.domain, params.to, params.subject, params.body, params.fromAddress),
    onSuccess: (_, variables) => {
      // Invalidate the 'sent' folder so it updates immediately
      queryClient.invalidateQueries({ queryKey: ['emails', variables.domain, 'sent'] });
    },
  });
}
