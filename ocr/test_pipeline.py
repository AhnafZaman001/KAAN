"""
Synthetic end-to-end test for the OCR pipeline.

We don't have a real photographed sheet yet, so this proves the
pipeline's *geometry* (marker detection + deskew + cropping) and
*classification logic* both work, using a sheet we fill in and
distort ourselves — so we know the ground truth and can measure
real accuracy instead of eyeballing it.

Steps:
  1. Generate a template (via generate_template.py) for N students.
  2. Render the flat PDF to a 300 DPI image.
  3. Draw a random P/A/M (or leave blank) into each box — this is
     our ground truth.
  4. Warp + rotate + JPEG-compress the image to simulate a real
     phone photo taken at a slight angle.
  5. Run the actual pipeline on that distorted image.
  6. Compare predictions to ground truth and report accuracy.
"""

import sys
import json
import random
import cv2
import numpy as np
from pdf2image import convert_from_path

sys.path.insert(0, "/home/claude/kaan-template")
sys.path.insert(0, "/home/claude/kaan-ocr")

from generate_template import generate_sheet
from pipeline import process_sheet, PT_TO_PX

random.seed(7)

WORKDIR = "/home/claude/kaan-ocr"


def make_roster(n):
    first_names = ['Ahmed', 'Ali', 'Bilal', 'Hamza', 'Usman', 'Zain', 'Hassan', 'Fahad',
                   'Omar', 'Saad', 'Sara', 'Ayesha', 'Fatima', 'Zainab', 'Mahnoor',
                   'Areeba', 'Hira', 'Maryam', 'Amna', 'Iqra']
    last_names = ['Khan', 'Raza', 'Ahmed', 'Malik', 'Sheikh', 'Hussain', 'Iqbal',
                  'Butt', 'Chaudhry', 'Farooq']
    return [
        {"roll_number": str(100 + i), "full_name": f"{random.choice(first_names)} {random.choice(last_names)}"}
        for i in range(1, n + 1)
    ]


def draw_ground_truth_marks(image, spec, blank_rate=0.08):
    """Draws a random P/A/M into each box on the flat rendered image.
    Returns the ground-truth dict: roll_number -> status drawn."""
    ground_truth = {}
    page_h_px = image.shape[0]

    for cell in spec["cells"]:
        roll = cell["roll_number"]
        box = cell["box"]

        if random.random() < blank_rate:
            ground_truth[roll] = "blank"
            continue

        label = random.choice(["P", "A", "M"])
        ground_truth[roll] = label

        x0 = box["x0"] * PT_TO_PX
        x1 = box["x1"] * PT_TO_PX
        y0 = page_h_px - box["y1"] * PT_TO_PX
        y1 = page_h_px - box["y0"] * PT_TO_PX

        box_w, box_h = x1 - x0, y1 - y0
        font = cv2.FONT_HERSHEY_SIMPLEX
        # jitter font scale/position slightly to mimic natural
        # handwriting variation between marks. Thin, consistent
        # stroke (like a ballpoint pen) so small glyph loops (the
        # bowl of a P, the apex of an A) don't get closed up by
        # stroke thickness + JPEG compression artifacts.
        scale = 1.15 + random.uniform(-0.1, 0.1)
        thickness = 2
        (tw, th), _ = cv2.getTextSize(label, font, scale, thickness)

        tx = int(x0 + (box_w - tw) / 2 + random.uniform(-2, 2))
        ty = int(y0 + (box_h + th) / 2 + random.uniform(-2, 2))

        cv2.putText(image, label, (tx, ty), font, scale, (0, 0, 0), thickness, cv2.LINE_AA)

    return ground_truth


def simulate_phone_photo(image, output_path):
    """Applies a mild random perspective warp + rotation + JPEG
    compression to simulate a phone photo taken at a slight angle,
    rather than a perfect flat scan."""
    h, w = image.shape[:2]

    # Pad with white margin first, simulating the sheet sitting on
    # a desk/background rather than filling the whole frame
    pad = int(0.08 * max(h, w))
    padded = cv2.copyMakeBorder(image, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    ph, pw = padded.shape[:2]

    src = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype="float32") + pad

    # Random small perspective jitter on each corner (simulates a
    # hand-held photo, not a perfectly overhead flatbed scan)
    jitter = 0.015 * max(h, w)
    dst = src + np.random.uniform(-jitter, jitter, src.shape).astype("float32")

    matrix = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(padded, matrix, (pw, ph), borderValue=(255, 255, 255))

    # Slight rotation too
    angle = random.uniform(-3, 3)
    center = (pw // 2, ph // 2)
    rot_matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(warped, rot_matrix, (pw, ph), borderValue=(255, 255, 255))

    # Mild blur + noise to mimic phone camera imperfection
    blurred = cv2.GaussianBlur(rotated, (3, 3), 0.3)

    cv2.imwrite(output_path, blurred, [cv2.IMWRITE_JPEG_QUALITY, 92])


def run_test(n_students=30):
    roster = make_roster(n_students)

    pdf_path = f"{WORKDIR}/test_sheet.pdf"
    spec_path = f"{WORKDIR}/test_spec.json"

    spec = generate_sheet(
        students=roster,
        school_name="KIPS College",
        section_name="Test-Section",
        attendance_date="",
        output_pdf_path=pdf_path,
        output_spec_path=spec_path,
    )

    # Render flat PDF at canonical DPI (300)
    pages = convert_from_path(pdf_path, dpi=300)
    flat = cv2.cvtColor(np.array(pages[0]), cv2.COLOR_RGB2BGR)

    # Only page-1 cells (keep the test to one page for simplicity)
    page1_cells = [c for c in spec["cells"] if c["page"] == 1]
    spec_page1 = dict(spec)
    spec_page1["cells"] = page1_cells

    ground_truth = draw_ground_truth_marks(flat, spec_page1)

    photo_path = f"{WORKDIR}/simulated_photo.jpg"
    simulate_phone_photo(flat, photo_path)

    # Save the page-1-only spec for the pipeline to consume
    spec_page1_path = f"{WORKDIR}/test_spec_page1.json"
    with open(spec_page1_path, "w") as f:
        json.dump(spec_page1, f)

    results = process_sheet(photo_path, spec_page1_path)

    # ---- Score against ground truth ----
    correct = 0
    review_flagged = 0
    mismatches = []

    for r in results:
        truth = ground_truth[r["roll_number"]]
        predicted = r["status"]
        is_correct = (predicted == truth)
        if is_correct:
            correct += 1
        else:
            mismatches.append((r["roll_number"], truth, predicted, r["confidence"], r["needs_review"]))
        if r["needs_review"]:
            review_flagged += 1

    total = len(results)
    accuracy = correct / total if total else 0

    print(f"Students on sheet: {total}")
    print(f"Correct classifications: {correct}/{total} ({accuracy:.1%})")
    print(f"Flagged for human review: {review_flagged}/{total} ({review_flagged/total:.1%})")
    print()

    # Of the ones NOT flagged for review, how accurate were we?
    auto_posted = [r for r in results if not r["needs_review"]]
    auto_correct = sum(1 for r in auto_posted if ground_truth[r["roll_number"]] == r["status"])
    if auto_posted:
        print(f"Accuracy on auto-posted (non-flagged) marks: {auto_correct}/{len(auto_posted)} "
              f"({auto_correct/len(auto_posted):.1%})")

    if mismatches:
        print("\nMismatches (roll, truth, predicted, confidence, was_flagged):")
        for m in mismatches:
            print(" ", m)

    return {
        "total": total,
        "accuracy": accuracy,
        "review_flagged": review_flagged,
        "auto_posted_accuracy": auto_correct / len(auto_posted) if auto_posted else None,
    }


if __name__ == "__main__":
    run_test(n_students=30)
