import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { auth } from '../api/client';

interface AuthGuardProps {
  children: ReactNode;
  requireSetup?: boolean;
}

/**
 * AuthGuard — Protects routes that require authentication.
 * Redirects to /login if no valid session exists.
 * Optionally redirects to /business-setup if business setup is incomplete.
 */
export default function AuthGuard({ children, requireSetup = false }: AuthGuardProps) {
  const location = useLocation();
  const user = auth.getSession();

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (requireSetup && !user.isBusinessSetupComplete) {
    return <Navigate to="/business-setup" replace />;
  }

  return <>{children}</>;
}
