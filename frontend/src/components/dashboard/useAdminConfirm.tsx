import { useCallback, useRef, useState } from 'react';
import { AdminConfirmDialog, type AdminConfirmRequest } from './AdminConfirm';

/**
 * Two-step confirmation for administrator actions.
 *
 * `confirm()` proposes an action and opens the dialog; nothing is executed
 * until the operator confirms it a second time. `dialog` has to be rendered
 * once by the panel that uses it.
 */
export function useAdminConfirm() {
  const [request, setRequest] = useState<AdminConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const requestRef = useRef<AdminConfirmRequest | null>(null);

  const confirm = useCallback((next: AdminConfirmRequest) => {
    requestRef.current = next;
    setBusy(false);
    setRequest(next);
  }, []);

  const cancel = useCallback(() => {
    const current = requestRef.current;
    requestRef.current = null;
    setBusy(false);
    setRequest(null);
    current?.onCancel?.();
  }, []);

  const accept = useCallback(() => {
    const current = requestRef.current;
    if (!current) return;
    setBusy(true);
    void Promise.resolve()
      .then(() => current.onConfirm())
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
        if (requestRef.current === current) {
          requestRef.current = null;
          setRequest(null);
        }
      });
  }, []);

  const dialog = <AdminConfirmDialog request={request} busy={busy} onCancel={cancel} onConfirm={accept} />;

  return { confirm, dialog };
}
