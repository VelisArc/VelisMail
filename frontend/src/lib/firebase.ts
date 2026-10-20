/**
 * Firebase Google sign-in.
 *
 * The SDK is loaded lazily so the marketing site does not pay the Firebase
 * bundle cost until a user actually chooses Google authentication. Client-side
 * config is public by design; server-side verification is performed by the
 * auth service against Google Identity Toolkit.
 *
 * The configuration is read from the build environment when it is available
 * and otherwise from the API (`/config/public`), so the Firebase project can
 * change without rebuilding the frontend. No secret is ever shipped to the
 * browser: only the public web configuration is used.
 */

type FirebaseWebConfig = {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  measurementId?: string;
};

const buildTimeConfig: FirebaseWebConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

function apiBase(): string {
  const configured = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
  if (configured) {
    if (configured.endsWith('/api/v1')) return configured;
    if (configured.endsWith('/api')) return `${configured}/v1`;
    if (configured.endsWith('/v1')) return configured.replace(/\/v1$/, '/api/v1');
    return `${configured}/api/v1`;
  }
  if (typeof window !== 'undefined') {
    const { hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://127.0.0.1:3000/api/v1';
    }
    if (
      hostname === 'velismail.online' ||
      hostname.endsWith('.velismail.online') ||
      hostname.endsWith('.pages.dev')
    ) {
      return 'https://api.velismail.online/api/v1';
    }
  }
  return 'https://api.velismail.online/api/v1';
}

function isUsable(config: FirebaseWebConfig): boolean {
  return Boolean(config.apiKey && config.projectId);
}

let configPromise: Promise<FirebaseWebConfig> | null = null;

async function resolveFirebaseConfig(): Promise<FirebaseWebConfig> {
  if (isUsable(buildTimeConfig)) return buildTimeConfig;
  if (!configPromise) {
    configPromise = (async () => {
      try {
        const response = await fetch(`${apiBase()}/config/public`, {
          headers: { Accept: 'application/json' },
        });
        if (response.ok) {
          const payload = await response.json();
          const remote = (payload?.firebase || payload) as FirebaseWebConfig;
          if (isUsable(remote)) {
            return {
              ...remote,
              authDomain: remote.authDomain || `${remote.projectId}.firebaseapp.com`,
              storageBucket: remote.storageBucket || `${remote.projectId}.firebasestorage.app`,
            } as FirebaseWebConfig;
          }
        }
      } catch {
        // Fall through to the configuration error below.
      }
      throw new Error(
        'Google sign-in is not configured. Set the VITE_FIREBASE_* variables for this build.',
      );
    })().finally(() => {
      configPromise = null;
    });
  }
  return configPromise;
}

export type GoogleIdentity = {
  idToken: string;
  uid: string;
  email: string;
  displayName?: string;
  photoUrl?: string;
};

let cachedAuth: import('firebase/auth').Auth | null = null;

async function getFirebaseAuth(): Promise<import('firebase/auth').Auth> {
  if (cachedAuth) return cachedAuth;
  const [{ getApps, initializeApp }, { getAuth, setPersistence, browserLocalPersistence }] =
    await Promise.all([import('firebase/app'), import('firebase/auth')]);
  const config = await resolveFirebaseConfig();
  const app = getApps().length ? getApps()[0] : initializeApp(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence).catch(() => undefined);
  cachedAuth = auth;
  return auth;
}

export async function signInWithGoogle(): Promise<GoogleIdentity> {
  const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
  const auth = await getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  const user = credential.user;
  const idToken = await user.getIdToken(true);
  return {
    idToken,
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || undefined,
    photoUrl: user.photoURL || undefined,
  };
}

export async function signOutFirebase(): Promise<void> {
  try {
    const { signOut } = await import('firebase/auth');
    const auth = await getFirebaseAuth();
    await signOut(auth);
  } catch {
    // Ignore: the local session is cleared regardless.
  }
}

export function platformOwnerUids(): string[] {
  return (import.meta.env.VITE_PLATFORM_OWNER_UIDS || '')
    .split(',')
    .map((value: string) => value.trim())
    .filter(Boolean);
}

/**
 * Email addresses configured as platform owners.
 *
 * A Firebase UID only exists after the very first verified sign-in, so owners
 * are usually configured by email instead. Both lists grant ownership.
 */
export function platformOwnerEmails(): string[] {
  return (import.meta.env.VITE_PLATFORM_OWNER_EMAILS || '')
    .split(',')
    .map((value: string) => value.trim().toLowerCase())
    .filter(Boolean);
}
