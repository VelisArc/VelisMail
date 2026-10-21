import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { auth, isBusinessSetupReady } from '../api/client';

interface AuthGuardProps {
  children: ReactNode;
  requireSetup?: boolean;
}

/**
 * AuthGuard — Protects routes that require authentication.
 * Redirects to /login if no valid session exists.
 * The workspace console (/business) owns the authoritative live setup gate, so
 * a workspace that is not configured yet is sent there instead of to a second
 * setup implementation.
 */
export default function AuthGuard({ children, requireSetup = false }: AuthGuardProps) {
  const location = useLocation();
  const user = auth.getSession();

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (requireSetup && !isBusinessSetupReady(user)) {
    return <Navigate to="/business" replace />;
  }

  return <>{children}</>;
}
