/**
 * Firebase Google sign-in.
 *
 * The SDK is loaded lazily so the marketing site does not pay the Firebase
 * bundle cost until a user actually chooses Google authentication. Client-side
 * config is public by design; server-side verification is performed by the
 * auth service against Google Identity Toolkit.
 */

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

function requireFirebaseConfig() {
  const required = ['apiKey', 'authDomain', 'projectId', 'appId'] as const;
  const missing = required.filter((key) => !firebaseConfig[key]);
  if (missing.length > 0) {
    throw new Error(
      'Google sign-in is not configured. Set the VITE_FIREBASE_* variables for this build.',
    );
  }
  return firebaseConfig;
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
  const app = getApps().length ? getApps()[0] : initializeApp(requireFirebaseConfig());
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
