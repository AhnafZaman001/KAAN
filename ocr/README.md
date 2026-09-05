# KAAN OCR Pipeline

Reads a photographed attendance sheet and returns a P/A/M reading
per student, using the coordinate spec that `scripts/generate_template.py`
produces alongside each printable sheet.

## How it works

1. **`detect_fiducial_markers()`** — finds the 4 solid black corner
   squares in the raw photo, however tilted the photo is.
2. **`warp_to_canonical()`** — perspective-corrects the photo to match
   the exact flat layout the PDF was printed at, using those markers.
3. **`crop_cell()`** — cuts out each mark-box using the coordinate
   spec, now that positions are trustworthy post-warp.
4. **`classify_mark()`** — rule-based P/A/M/blank classifier using
   dark-pixel ratio (mark vs blank) and enclosed-loop detection
   (M has no loop; P's loop is bigger than A's). No trained model yet.

## Status: v1, calibrated on synthetic data only

The classifier's thresholds were tuned against a synthetic test sheet
(`test_pipeline.py` renders marks in a regular font, not real
handwriting). It currently achieves 100% accuracy on everything it
auto-posts, but flags ~60% of marks for human review — meaning it's
conservative, not necessarily accurate on real ink yet.

**Next step before trusting this on live sheets**: run
`test_pipeline.py`'s approach against real photographed, hand-marked
sheets once printed sheets exist, and retune `BLANK_DARK_RATIO_THRESHOLD`
and the hole-area P/A boundary in `pipeline.py` against real samples.
If accuracy doesn't improve enough, the fallback (as planned from the
start) is training a small classifier on real sample crops instead of
the rule-based heuristic — the pipeline's crop/warp stages don't
change either way, only `classify_mark()` would be swapped out.

## Usage

```python
from pipeline import process_sheet

results = process_sheet("photo_of_sheet.jpg", "coords_FSc-1st-A.json")
# [{"roll_number": "101", "full_name": "Ali Raza", "status": "P",
#   "confidence": 0.82, "needs_review": False}, ...]
```

## Testing

```bash
pip install -r requirements.txt
pip install pdf2image  # also needs poppler-utils installed on the system
python3 test_pipeline.py
```

Generates a synthetic filled-in sheet, distorts it like a phone photo,
runs it through the real pipeline, and reports accuracy against the
known ground truth.
