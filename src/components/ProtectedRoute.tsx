import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { LoadingPage } from '@/components/LoadingSpinner';

export function ProtectedRoute() {
  const { session, loading } = useAuth();

  if (loading) {
    return <LoadingPage />;
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return <Outlet />;
}
