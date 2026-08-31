'use client';

import * as React from 'react';

export type User = { id: number; name: string; role: 'attorney' | 'paralegal' };
export type Matter = { id: number; clientName: string; title: string };

type IdentityState = {
  users: User[];
  matters: Matter[];
  userId: number | null;
  setUserId: (id: number) => void;
  user: User | null;
  loading: boolean;
  error: string | null;
};

const IdentityContext = React.createContext<IdentityState | null>(null);

const STORAGE_KEY = 'matter-memory:userId';

/**
 * Holds who you are and which matters exist, shared by both pages.
 *
 * The identity selector lives here rather than in the upload form because
 * CLAUDE.md fixes that form at exactly three fields - file, matter,
 * sensitivity - but the API needs a userId. Putting it in the shared header
 * satisfies both.
 *
 * Note what is stored: a user ID, never a role. The server looks the role up.
 */
export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const [users, setUsers] = React.useState<User[]>([]);
  const [matters, setMatters] = React.useState<Matter[]>([]);
  const [userId, setUserIdState] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/bootstrap');
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? 'Failed to load');

        setUsers(data.users);
        setMatters(data.matters);

        // Restore the previous choice, but only if that user still exists -
        // re-seeding resets the table.
        const stored = Number(window.localStorage.getItem(STORAGE_KEY));
        const restored = data.users.find((u: User) => u.id === stored);
        setUserIdState(restored ? restored.id : (data.users[0]?.id ?? null));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const setUserId = React.useCallback((id: number) => {
    setUserIdState(id);
    window.localStorage.setItem(STORAGE_KEY, String(id));
  }, []);

  const user = users.find((u) => u.id === userId) ?? null;

  const value = React.useMemo(
    () => ({ users, matters, userId, setUserId, user, loading, error }),
    [users, matters, userId, setUserId, user, loading, error],
  );

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityState {
  const ctx = React.useContext(IdentityContext);
  if (!ctx) throw new Error('useIdentity must be used inside IdentityProvider');
  return ctx;
}
