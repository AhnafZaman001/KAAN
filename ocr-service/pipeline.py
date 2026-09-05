"""
KAAN — Attendance Sheet OCR Pipeline
=======================================
Takes a photographed (JPG) attendance sheet + the coordinate spec
produced by generate_template.py, and returns a P/A/M reading for
every student on the sheet, each with a confidence score.

Pipeline stages:
    1. detect_fiducial_markers() — find the 4 solid black corner
       squares in the raw photo, however tilted/warped it is.
    2. warp_to_canonical()       — perspective-correct the photo so
       it matches the exact flat layout the PDF was printed at.
    3. crop_cell()               — cut out each mark-box using the
       coordinate spec, now that positions are trustworthy.
    4. classify_mark()           — rule-based P/A/M/blank classifier
       using dark-pixel ratio + hole/loop counting. No ML model yet
       — this is the cheap first-pass classifier discussed earlier;
       a trained model can slot in later as a fallback for whatever
       this can't classify confidently.

Everything below is deliberately dependency-light (opencv + numpy
only) so it can run as a standalone script, a Supabase Edge
Function, or inside a Next.js API route via a Python subprocess —
whichever wiring makes sense once this plugs into the app.
"""

import json
import cv2
import numpy as np

# ---- Canonical rendering resolution ----
# The coordinate spec from generate_template.py is in PDF points
# (72 per inch). We warp every photo to a fixed-DPI canonical image
# so those point coordinates convert to pixels with one constant.
TARGET_DPI = 300
PT_TO_PX = TARGET_DPI / 72.0

# ---- Classification thresholds (tuned on synthetic data — expect
# to retune these against real scanned sheets once available) ----
BLANK_DARK_RATIO_THRESHOLD = 0.015  # below this fraction dark → blank/unmarked
CONFIDENT_MARGIN = 0.05             # how far a reading must sit from a decision
                                     # boundary to count as "confident"


def order_points(pts):
    """Given 4 (x, y) points in any order, return them ordered as
    [top-left, top-right, bottom-right, bottom-left]."""
    pts = np.array(pts, dtype="float32")
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).flatten()

    top_left = pts[np.argmin(s)]
    bottom_right = pts[np.argmax(s)]
    top_right = pts[np.argmin(diff)]
    bottom_left = pts[np.argmax(diff)]

    return np.array([top_left, top_right, bottom_right, bottom_left], dtype="float32")


def detect_fiducial_markers(image):
    """
    Finds the 4 solid black corner squares in a raw photo.
    Returns 4 (x, y) points ordered [TL, TR, BR, BL], or raises
    ValueError if fewer/more than 4 plausible markers are found.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    # Otsu threshold — markers are the darkest regions on the page
    _, binary = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    h, w = gray.shape
    image_area = h * w

    candidates = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        # Markers should be a small, consistent fraction of the page —
        # reject anything wildly too small (noise) or too large
        # (shadows, dark backgrounds, the photo's own border).
        if area < image_area * 0.0005 or area > image_area * 0.02:
            continue

        x, y, bw, bh = cv2.boundingRect(cnt)
        aspect = bw / float(bh)
        if not (0.7 < aspect < 1.3):
            continue  # markers are square — reject elongated blobs

        # Squareness check: contour area should closely fill its
        # bounding box (a real filled square does; stray dark
        # blobs/text usually don't).
        fill_ratio = area / float(bw * bh)
        if fill_ratio < 0.7:
            continue

        cx, cy = x + bw / 2.0, y + bh / 2.0
        candidates.append({"center": (cx, cy), "area": area})

    if len(candidates) < 4:
        raise ValueError(
            f"Only found {len(candidates)} candidate markers, need 4. "
            "Check lighting/focus, or that all 4 corners are visible in frame."
        )

    # Keep the single best (closest-to-square, most consistently
    # sized) candidate nearest each of the 4 image quadrants.
    quadrants = {
        "tl": lambda c: c[0] < w / 2 and c[1] < h / 2,
        "tr": lambda c: c[0] >= w / 2 and c[1] < h / 2,
        "bl": lambda c: c[0] < w / 2 and c[1] >= h / 2,
        "br": lambda c: c[0] >= w / 2 and c[1] >= h / 2,
    }

    chosen = []
    for quad, test in quadrants.items():
        quad_candidates = [c for c in candidates if test(c["center"])]
        if not quad_candidates:
            raise ValueError(f"No marker candidate found in quadrant '{quad}'.")
        # Prefer the largest matching blob in that quadrant (least
        # likely to be noise/text mistaken for a marker).
        best = max(quad_candidates, key=lambda c: c["area"])
        chosen.append(best["center"])

    return order_points(chosen)


def warp_to_canonical(image, marker_points, page_size_pt, marker_size_pt, marker_margin_pt):
    """
    Perspective-warps the photo so the 4 detected markers land
    exactly where they should be on a flat, canonical-DPI render
    of the original PDF page. After this, coordinates from the
    spec JSON can be trusted directly.
    """
    page_w_px = page_size_pt[0] * PT_TO_PX
    page_h_px = page_size_pt[1] * PT_TO_PX
    margin_px = marker_margin_pt * PT_TO_PX
    marker_px = marker_size_pt * PT_TO_PX

    # Target = center of each marker square, in the canonical image
    dst = np.array([
        [margin_px + marker_px / 2, margin_px + marker_px / 2],                          # TL
        [page_w_px - margin_px - marker_px / 2, margin_px + marker_px / 2],               # TR
        [page_w_px - margin_px - marker_px / 2, page_h_px - margin_px - marker_px / 2],   # BR
        [margin_px + marker_px / 2, page_h_px - margin_px - marker_px / 2],               # BL
    ], dtype="float32")

    matrix = cv2.getPerspectiveTransform(marker_points, dst)
    warped = cv2.warpPerspective(image, matrix, (int(page_w_px), int(page_h_px)))
    return warped


def crop_cell(warped_image, box_pt, inset_px=6):
    """Crops one mark-box out of the canonical warped image, using
    the box coordinates (in PDF points, PDF's bottom-left origin)
    from the spec JSON. Insets inward slightly so the printed box
    border itself doesn't get picked up as ink by the classifier."""
    page_h_px = warped_image.shape[0]

    x0 = box_pt["x0"] * PT_TO_PX
    x1 = box_pt["x1"] * PT_TO_PX
    # Flip y: PDF origin is bottom-left, image origin is top-left
    y0 = page_h_px - box_pt["y1"] * PT_TO_PX
    y1 = page_h_px - box_pt["y0"] * PT_TO_PX

    x0, y0 = int(x0) + inset_px, int(y0) + inset_px
    x1, y1 = int(x1) - inset_px, int(y1) - inset_px

    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = max(x0 + 1, x1), max(y0 + 1, y1)

    return warped_image[y0:y1, x0:x1]


def classify_mark(cell_image):
    """
    Rule-based classifier for a single cropped cell.
    Returns (status, confidence) where status is one of
    'P', 'A', 'M', 'blank', or 'unclear'.

    Logic:
      - Very little dark ink → nothing written → 'blank'
      - Ink present, zero enclosed loops → 'M' (M has no closed hole)
      - Ink present, exactly one enclosed loop → look at where the
        loop sits vertically: P's loop is near the top (bowl under
        the top curve), A's loop sits lower/more central.
      - Anything else (multiple loops, ambiguous position) → 'unclear',
        always sent to the human review queue regardless of the
        numeric confidence score.
    """
    if cell_image.size == 0:
        return "unclear", 0.0

    gray = cv2.cvtColor(cell_image, cv2.COLOR_BGR2GRAY) if cell_image.ndim == 3 else cell_image
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    h, w = binary.shape
    dark_ratio = np.count_nonzero(binary) / float(h * w)

    if dark_ratio < BLANK_DARK_RATIO_THRESHOLD:
        # Confidence scales with how far below threshold — very
        # clearly empty vs borderline-faint mark.
        confidence = min(1.0, (BLANK_DARK_RATIO_THRESHOLD - dark_ratio) / BLANK_DARK_RATIO_THRESHOLD + 0.5)
        return "blank", round(confidence, 3)

    contours, hierarchy = cv2.findContours(binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return "unclear", 0.3

    # Count holes: contours whose hierarchy parent != -1 are inner
    # (enclosed) contours — i.e. loops.
    holes = [
        cnt for cnt, hier in zip(contours, hierarchy[0])
        if hier[3] != -1 and cv2.contourArea(cnt) > (h * w * 0.004)
    ]

    if len(holes) == 0:
        # No enclosed loop + real ink present → M
        confidence = min(1.0, 0.55 + dark_ratio)
        return "M", round(confidence, 3)

    if len(holes) == 1:
        hole = holes[0]
        hole_area_ratio = cv2.contourArea(hole) / float(h * w)

        # Measured from calibration: P's bowl loop is meaningfully
        # larger than A's triangular loop, relative to the box.
        # Position (top vs bottom) was tested and found too weak a
        # signal on its own — loop size discriminates better.
        if hole_area_ratio > 0.022 + CONFIDENT_MARGIN:
            return "P", round(min(1.0, 0.5 + hole_area_ratio), 3)
        elif hole_area_ratio < 0.022 - CONFIDENT_MARGIN:
            return "A", round(min(1.0, 0.5 + (0.022 - hole_area_ratio) * 5), 3)
        else:
            # Too close to the boundary to confidently tell P from
            # A — don't guess, send to review.
            return "unclear", 0.4

    # Multiple loops — noisy mark, smudge, or overlapping strokes
    return "unclear", 0.2


def process_sheet(image_path, spec_path):
    """
    Full pipeline: photo + spec → list of per-student readings.
    """
    with open(spec_path) as f:
        spec = json.load(f)

    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"Could not read image: {image_path}")

    markers = detect_fiducial_markers(image)
    warped = warp_to_canonical(
        image,
        markers,
        page_size_pt=spec["page_size_pt"],
        marker_size_pt=spec["fiducial_marker_size_pt"],
        marker_margin_pt=10 * (72 / 25.4),  # 10mm in points — matches generate_template.py's MARKER_MARGIN
    )

    results = []
    for cell in spec["cells"]:
        cropped = crop_cell(warped, cell["box"])
        status, confidence = classify_mark(cropped)
        confidence = float(confidence)

        needs_review = bool(status == "unclear" or confidence < 0.6)

        results.append({
            "roll_number": cell["roll_number"],
            "full_name": cell["full_name"],
            "status": status,
            "confidence": confidence,
            "needs_review": needs_review,
        })

    return results
