"use client";
import { useEffect, useRef, useState } from 'react';

const WARN_SECONDS = 120; // the notice shows this long before the session ends
const TICK_MS = 30_000; // the clock is checked every 30 seconds, so a screen reader is never told every second

type Probe = { user: { staffExpiresInSeconds?: number | null; staffEndsBy?: 'idle' | 'absolute' | null } | null };

/**
 * Staff sessions end after 30 minutes without use (N-11). Shows a calm notice two minutes before, with a button
 * that counts as use. Reading the time uses `?peek=1`, which does not count as use, so the timer never keeps a session alive.
 * Learners have `staffExpiresInSeconds: null` and see nothing.
 */
export function StaffSessionNotice() {
  const [show, setShow] = useState(false);
  const [endsBy, setEndsBy] = useState<'idle' | 'absolute'>('idle');
  const deadline = useRef<number | null>(null);

  const read = async (touch: boolean) => {
    try {
      const d = await (await fetch(touch ? '/api/auth/session' : '/api/auth/session?peek=1', { cache: 'no-store' })).json() as Probe;
      const left = d.user?.staffExpiresInSeconds;
      if (typeof left === 'number') { setEndsBy(d.user?.staffEndsBy === 'absolute' ? 'absolute' : 'idle'); deadline.current = Date.now() + left * 1000; return left; }
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload on purpose: the session is gone
      if (deadline.current !== null && !d.user) window.location.href = '/login'; // the session ended
      deadline.current = null;
    } catch { /* offline: try again at the next tick */ }
    return null;
  };

  useEffect(() => {
    void read(true);
    const t = setInterval(async () => {
      if (deadline.current === null || deadline.current - Date.now() > WARN_SECONDS * 1000) { setShow(false); return; }
      const left = await read(false);
      setShow(left !== null && left <= WARN_SECONDS);
    }, TICK_MS);
    return () => clearInterval(t);
  }, []);

  // The role=status container is always in the page and starts empty; the text is added later so screen readers announce it.
  return (
    <div role="status">
      {show && (
        <div className="staff-session-notice" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '6px 14px', border: '1px solid var(--line)', borderRadius: 12 }}>
          {endsBy === 'absolute' ? (
            <span>
              <span lang="ar" dir="rtl">ستنتهي جلستك قريبًا لأنها بلغت الحد الزمني، وعليك تسجيل الدخول من جديد.</span>{' '}
              <span lang="en" dir="ltr">Your session will end soon because it reached its time limit. You will need to sign in again.</span>
            </span>
          ) : (
            <>
              <span>
                <span lang="ar" dir="rtl">ستنتهي جلستك قريبًا لأنك لم تستخدمها.</span>{' '}
                <span lang="en" dir="ltr">Your session will end soon because it has not been used.</span>
              </span>
              <button className="account-link" onClick={async () => { await read(true); setShow(false); }}>
                <span lang="ar" dir="rtl">ابقَ مسجّلًا</span>{' '}<span lang="en" dir="ltr">Stay signed in</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
