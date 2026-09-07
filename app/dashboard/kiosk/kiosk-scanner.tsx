'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import jsQR from 'jsqr';
import styles from './kiosk.module.css';

type Phase = 'setup' | 'scanning' | 'closed';
type Feedback = { type: 'success' | 'error' | 'idle'; message: string };

const SCAN_COOLDOWN_MS = 2500; // ignore repeat scans of the same QR for this long

export function KioskScanner({ sections }: { sections: { id: string; name: string }[] }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>({ type: 'idle', message: 'Point a QR code at the camera' });
  const [summary, setSummary] = useState<{ scanned_count: number; auto_absent_count: number } | null>(null);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastScanRef = useRef<{ token: string; time: number } | null>(null);

  const stopCamera = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

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

    try {
      const res = await fetch('/api/kiosk/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, qr_token: token }),
      });
      const data = await res.json();

      if (!res.ok) {
        setFeedback({ type: 'error', message: data.error ?? 'Scan failed.' });
        return;
      }

      setFeedback({
        type: 'success',
        message: `✓ ${data.full_name} (Roll ${data.roll_number})`,
      });
    } catch {
      setFeedback({ type: 'error', message: 'Network error — check connection and retry.' });
    }
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

        <div
          className={`${styles.feedback} ${
            feedback.type === 'success'
              ? styles.feedbackSuccess
              : feedback.type === 'error'
                ? styles.feedbackError
                : styles.feedbackIdle
          }`}
        >
          {feedback.message}
        </div>

        <button className={styles.endButton} onClick={endSession} disabled={ending}>
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
