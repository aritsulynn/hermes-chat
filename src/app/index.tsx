// Root index — expo-router needs a `/` route; auth gating lives in the
// screens themselves (login bounces authed users to /chat).
import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/login" />;
}
