import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GoogleOAuthProvider } from '@react-oauth/google';
import './index.css';
import App from './App.tsx';
import { registerWorker, watchForeground, prepare } from './services/push';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10000,
    },
  },
});

// Empty string disables Google login — useful for local dev without OAuth
// credentials; the button simply doesn't render until VITE_GOOGLE_CLIENT_ID
// is set in the deploy environment.
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

const app = (
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);

// Mounting the provider with an empty client id makes Google's script throw
// once it loads, which blanks the page — so only mount it when configured.
// The worker is registered for everyone, whether or not they have agreed to
// notifications: it has to already be running before the browser will let
// anyone subscribe, and it caches nothing, so for someone who never turns
// alerts on it simply sits there. The badge is cleared on the way in — if
// an alert arrived overnight, opening the app is reading it.
registerWorker().then(() => {
  watchForeground();
  // Collect the server key now rather than when somebody taps "turn on":
  // Safari will not subscribe once the tap has waited on the network.
  prepare();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {googleClientId
      ? <GoogleOAuthProvider clientId={googleClientId}>{app}</GoogleOAuthProvider>
      : app}
  </StrictMode>,
);
