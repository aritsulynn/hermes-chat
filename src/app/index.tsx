// Root index — React Router needs a `/` route; auth gating lives in the
// screens themselves (login bounces authed users to /chat).
import { Navigate } from 'react-router-dom';

export default function Index() {
  return <Navigate to="/login" replace />;
}
