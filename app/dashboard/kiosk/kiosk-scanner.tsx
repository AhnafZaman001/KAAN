'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import jsQR from 'jsqr';
import { queueScan, getQueuedScans, removeQueuedScan, queuedScanCount } from '@/lib/offline-scan-queue';
import styles from './kiosk.module.css';

type Phase = 'setup' | 'scanning' | 'closed';
type Feedback = { type: 'success' | 'repeat' | 'queued' | 'error' | 'idle'; message: string };

const SCAN_COOLDOWN_MS = 2500; // ignore repeat scans of the same QR for this long
const SYNC_INTERVAL_MS = 5000; // how often to retry queued scans

export function KioskScanner({ sections }: { sections: { id: string; name: string }[] }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>({ type: 'idle', message: 'Point a QR code at the camera' });
  const [summary, setSummary] = useState<{ scanned_count: number; auto_absent_count: number } | null>(null);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [scannedCount, setScannedCount] = useState(0);
  const [totalStudents, setTotalStudents] = useState(0);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastScanRef = useRef<{ token: string; time: number } | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const scannedRollsRef = useRef<Set<string>>(new Set()); // dedupe local scannedCount

  const stopCamera = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  // ---- Background sync loop for offline-queued scans ----
  useEffect(() => {
    if (phase !== 'scanning') return;

    async function trySync() {
      const queued = await getQueuedScans();
      setPendingSyncCount(queued.length);

      for (const item of queued) {
        try {
          const res = await fetch('/api/kiosk/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: item.session_id, qr_token: item.qr_token }),
          });

          // Whether it succeeded or the server gave a real rejection
          // (not a network failure), it's resolved — remove from queue.
          // A genuine network failure throws before we get here.
          await res.json().catch(() => null);
          await removeQueuedScan(item.id);
        } catch {
          // Still offline — leave it queued, try again next interval.
          break;
        }
      }

      setPendingSyncCount(await queuedScanCount());
    }

    trySync();
    const interval = setInterval(trySync, SYNC_INTERVAL_MS);
    window.addEventListener('online', trySync);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', trySync);
    };
  }, [phase]);

  async function startSession(e: React.FormEvent) {
    e.preventDefault();
    setSetupError(null);
    setStarting(true);

    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch('/api/kiosk/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section_id: sectionId, session_date: today }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not start session.');

      setSessionId(data.session_id);
      sessionIdRef.current = data.session_id;
      setTotalStudents(data.total_active_students ?? 0);
      setScannedCount(0);
      scannedRollsRef.current = new Set();
      setPhase('scanning');
      await startCamera();
    } catch (err: any) {
      setSetupError(err.message);
    } finally {
      setStarting(false);
    }
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      requestAnimationFrame(scanLoop);
    } catch (err: any) {
      setFeedback({ type: 'error', message: 'Could not access camera: ' + err.message });
    }
  }

  function scanLoop() {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code && code.data) {
          handleScan(code.data);
        }
      }
    }

    animationRef.current = requestAnimationFrame(scanLoop);
  }

  async function handleScan(token: string) {
    const now = Date.now();
    const last = lastScanRef.current;
    if (last && last.token === token && now - last.time < SCAN_COOLDOWN_MS) {
      return; // still on cooldown for this exact code
    }
    lastScanRef.current = { token, time: now };

    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) return;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const res = await fetch('/api/kiosk/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: currentSessionId, qr_token: token }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await res.json();

      if (!res.ok) {
        setFeedback({ type: 'error', message: data.error ?? 'Scan failed.' });
        return;
      }

      if (data.is_first_scan) {
        if (!scannedRollsRef.current.has(data.roll_number)) {
          scannedRollsRef.current.add(data.roll_number);
          setScannedCount(scannedRollsRef.current.size);
        }
        setFeedback({
          type: 'success',
          message: `✓ ${data.full_name} (Roll ${data.roll_number})`,
        });
      } else {
        setFeedback({
          type: 'repeat',
          message: `Already scanned — ${data.full_name} (Roll ${data.roll_number})`,
        });
      }
    } catch {
      // Network failure (offline, timeout, WiFi hiccup) — the scan
      // itself is never lost, just queued for background sync.
      await queueScan({
        id: `${currentSessionId}-${token}-${now}`,
        session_id: currentSessionId,
        qr_token: token,
        queued_at: new Date().toISOString(),
      });
      setPendingSyncCount(await queuedScanCount());
      setFeedback({
        type: 'queued',
        message: 'No connection — scan saved, will sync automatically',
      });
    }
  }

  async function confirmAndEndSession() {
    const unscanned = totalStudents - scannedCount;
    const proceed = window.confirm(
      unscanned > 0
        ? `${scannedCount} of ${totalStudents} students have scanned.\n\nEnding now will mark the remaining ${unscanned} absent. Continue?`
        : `All ${totalStudents} students have scanned. End the session?`
    );
    if (!proceed) return;

    if (pendingSyncCount > 0) {
      const proceedAnyway = window.confirm(
        `${pendingSyncCount} scan(s) haven't synced yet (offline). Ending now may mark those students absent instead. Wait for a connection, or continue anyway?`
      );
      if (!proceedAnyway) return;
    }

    await endSession();
  }

  async function endSession() {
    if (!sessionId) return;
    setEnding(true);
    stopCamera();

    try {
      const res = await fetch('/api/kiosk/session/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not close session.');

      setSummary({ scanned_count: data.scanned_count, auto_absent_count: data.auto_absent_count });
      setPhase('closed');
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setEnding(false);
    }
  }

  if (phase === 'closed' && summary) {
    return (
      <div className={styles.summary}>
        <p style={{ marginBottom: 'var(--space-4)' }}>Session closed.</p>
        <div className={styles.summaryStat}>{summary.scanned_count}</div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>scanned present</p>
        <div className={styles.summaryStat} style={{ marginTop: 'var(--space-4)' }}>
          {summary.auto_absent_count}
        </div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          marked absent automatically
        </p>
      </div>
    );
  }

  if (phase === 'scanning') {
    return (
      <div className={styles.scanWrap}>
        <div className={styles.videoFrame}>
          <video ref={videoRef} className={styles.video} playsInline muted />
          <div className={styles.scanFrame} />
        </div>
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        <div className={styles.statusBar}>
          <span>
            {scannedCount} / {totalStudents} scanned
          </span>
          {pendingSyncCount > 0 && (
            <span className={styles.pendingBadge}>{pendingSyncCount} pending sync</span>
          )}
        </div>

        <div
          key={feedback.message}
          className={`${styles.feedback} ${
            feedback.type === 'success'
              ? styles.feedbackSuccess
              : feedback.type === 'repeat'
                ? styles.feedbackRepeat
                : feedback.type === 'queued'
                  ? styles.feedbackQueued
                  : feedback.type === 'error'
                    ? styles.feedbackError
                    : styles.feedbackIdle
          }`}
        >
          {feedback.message}
        </div>

        <button className={styles.endButton} onClick={confirmAndEndSession} disabled={ending}>
          {ending ? 'Ending session…' : 'End session'}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={startSession}>
      {setupError && <div className={styles.error}>{setupError}</div>}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="section">
          Section
        </label>
        <select
          id="section"
          className={styles.select}
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <button type="submit" className={styles.submit} disabled={starting}>
        {starting ? 'Starting…' : 'Start scanning session'}
      </button>
    </form>
  );
}
