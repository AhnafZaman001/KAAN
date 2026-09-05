# KAAN OCR Service

FastAPI microservice wrapping the OCR pipeline (`pipeline.py`) and the
attendance sheet template generator (`generate_template.py`). Deployed
separately from the Next.js app because OpenCV + reportlab need a real
Python runtime with system libraries — Vercel's Next.js serverless
functions don't support that.

## Endpoints

- `GET /health` — liveness check
- `POST /generate-sheet` — roster in, printable PDF (base64) + coordinate
  spec out. Used by "Print sheet" in the app.
- `POST /generate-spec` — same coordinate math, no PDF render. Used when
  processing an uploaded photo, to regenerate the spec that matches
  whatever was printed.
- `POST /process-sheet` — photo + spec in, per-student P/A/M readings out.
  Used by "Upload sheet" in the app.

## Local development

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Test it:
```bash
curl http://localhost:8000/health
```

## Deploying

Any host that runs a Docker container works. **Render** is the
simplest for a project this size (free tier available, no credit
card required to start):

1. Push this repo to GitHub (already done, if you're reading this
   from the repo).
2. On [render.com](https://render.com), New → Web Service → connect
   your GitHub repo.
3. **Root Directory**: `ocr-service` (important — this folder, not
   the repo root, since the Next.js app lives in the same repo).
4. **Runtime**: Docker (it'll auto-detect the `Dockerfile`).
5. **Instance type**: free tier is fine to start; expect cold starts
   (~30s) after idle periods — worth upgrading once this is handling
   real daily traffic from exam cell staff, so it doesn't feel slow
   every morning.
6. Add an environment variable: `ALLOWED_ORIGIN` = your deployed
   Vercel app's URL (e.g. `https://kaan-flame.vercel.app`) — locks
   down CORS so only your app can call this service.
7. Deploy. Render gives you a URL like
   `https://kaan-ocr.onrender.com`.
8. Add that URL as `OCR_SERVICE_URL` in your **Vercel** project's
   environment variables (not `NEXT_PUBLIC_` — this stays
   server-side only, since it's only ever called from API routes,
   never the browser).
9. Redeploy the Vercel app so it picks up the new env var.

Alternatives if you outgrow Render's free tier or want something
different: Railway, Fly.io, or a plain VPS running the Docker image
behind Caddy/nginx.

## Calibration status

The classifier in `pipeline.py` is currently tuned against synthetic
(font-rendered) marks — see `test_pipeline.py` and its results. Real
handwriting will behave differently. Once real photographed sheets
start coming in through the app, the actual next step is:

1. Pull a batch of real (sheet photo, human-corrected result) pairs
   from the `attendance_corrections` table + Storage.
2. Re-run `test_pipeline.py`-style accuracy checks against those real
   crops instead of synthetic ones.
3. Retune `BLANK_DARK_RATIO_THRESHOLD` and the hole-area P/A boundary
   in `classify_mark()` accordingly — or, if rule-based tuning plateaus,
   train a small classifier on the real crops as the documented fallback.
