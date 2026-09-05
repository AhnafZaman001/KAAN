"""
KAAN — Attendance Sheet Template Generator
============================================
Generates a printable grid-format attendance sheet for one section,
one day. Also writes out a JSON coordinate spec describing exactly
where every mark-box sits on the page (in PDF points, origin at
bottom-left) — the OCR pipeline will use this same spec to know
precisely where to crop each cell after a sheet is scanned, instead
of having to detect box positions from the image itself.

Usage:
    python generate_template.py

Customize by editing the `students`, `school_name`, `section_name`,
and `attendance_date` values in the __main__ block, or import
`generate_sheet()` directly from another script (e.g. later, driven
by a real roster pulled from Supabase).
"""

import json
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm

PAGE_W, PAGE_H = A4

# ---- Fiducial markers (corner squares for auto-deskew) ----
MARKER_SIZE = 10 * mm
MARKER_MARGIN = 10 * mm

# ---- Table layout ----
TABLE_TOP_MARGIN = 58 * mm   # space reserved for header block
TABLE_BOTTOM_MARGIN = 34 * mm  # space reserved for signature footer
SIDE_MARGIN = 18 * mm
COLUMN_GAP = 10 * mm

ROW_HEIGHT = 8 * mm
BOX_SIZE = 7 * mm

ROLL_COL_WIDTH = 14 * mm
NAME_COL_WIDTH = 42 * mm
# box column width = BOX_SIZE

MAX_ROWS_PER_COLUMN_PAGE1 = None  # computed at runtime


def _draw_fiducial_markers(c):
    """Solid black squares in all 4 corners. The scan/deskew step
    locates these to compute rotation and map every cell's exact
    position, even if the photo is taken at a slight angle."""
    positions = [
        (MARKER_MARGIN, PAGE_H - MARKER_MARGIN - MARKER_SIZE),  # top-left
        (PAGE_W - MARKER_MARGIN - MARKER_SIZE, PAGE_H - MARKER_MARGIN - MARKER_SIZE),  # top-right
        (MARKER_MARGIN, MARKER_MARGIN),  # bottom-left
        (PAGE_W - MARKER_MARGIN - MARKER_SIZE, MARKER_MARGIN),  # bottom-right
    ]
    c.setFillColorRGB(0, 0, 0)
    for x, y in positions:
        c.rect(x, y, MARKER_SIZE, MARKER_SIZE, fill=1, stroke=0)
    return positions


def _draw_header(c, school_name, section_name, attendance_date, page_num, total_pages):
    top_y = PAGE_H - MARKER_MARGIN - MARKER_SIZE - 8 * mm

    c.setFont("Helvetica-Bold", 13)
    c.setFillColorRGB(0, 0, 0)
    c.drawString(SIDE_MARGIN, top_y, school_name)

    line2_y = top_y - 8 * mm
    line3_y = top_y - 15 * mm
    line4_y = top_y - 22 * mm  # instruction line

    c.setFont("Helvetica", 9)
    suffix = f"  (page {page_num} of {total_pages})" if total_pages > 1 else ""
    c.drawString(SIDE_MARGIN, line2_y, f"Section: {section_name}{suffix}")
    c.drawString(SIDE_MARGIN, line3_y, "First Lecture Attendance")

    # Date field — printed label, blank line for the teacher to fill
    date_label_x = PAGE_W - SIDE_MARGIN - 60 * mm
    c.drawString(date_label_x, line2_y, "Date: " + (attendance_date or "________________"))
    c.drawString(date_label_x, line3_y, "Teacher: ________________")

    c.setFont("Helvetica-Oblique", 7.5)
    c.drawString(
        SIDE_MARGIN, line4_y,
        "Mark P (present), A (absent), or M (medical) clearly inside each box."
    )


def _draw_footer(c):
    y = MARKER_MARGIN + MARKER_SIZE + 5 * mm
    c.setFont("Helvetica", 8)
    c.drawString(SIDE_MARGIN, y, "Teacher signature: ________________________________")
    c.drawString(PAGE_W - SIDE_MARGIN - 55 * mm, y, "Total present: _______ / _______")


def generate_sheet(
    students,
    school_name,
    section_name,
    attendance_date,
    output_pdf_path,
    output_spec_path,
):
    """
    students: list of dicts, each {"roll_number": str, "full_name": str}
    Returns the coordinate spec dict that also gets written to output_spec_path.
    """
    usable_height = PAGE_H - TABLE_TOP_MARGIN - TABLE_BOTTOM_MARGIN
    rows_per_column = int(usable_height // ROW_HEIGHT)

    table_width = PAGE_W - 2 * SIDE_MARGIN
    column_width = (table_width - COLUMN_GAP) / 2
    rows_per_page = rows_per_column * 2  # two columns per page

    total_pages = max(1, -(-len(students) // rows_per_page))  # ceil division

    c = canvas.Canvas(output_pdf_path, pagesize=A4)
    spec = {
        "page_size_pt": [PAGE_W, PAGE_H],
        "units": "pt (72 per inch), origin bottom-left, matches reportlab/PDF convention",
        "school_name": school_name,
        "section_name": section_name,
        "attendance_date": attendance_date,
        "fiducial_marker_size_pt": MARKER_SIZE,
        "cells": [],  # filled below: one entry per student per page
    }

    idx = 0
    for page_num in range(1, total_pages + 1):
        markers = _draw_fiducial_markers(c)
        _draw_header(c, school_name, section_name, attendance_date, page_num, total_pages)
        _draw_footer(c)

        table_top_y = PAGE_H - TABLE_TOP_MARGIN

        for col in range(2):
            col_x = SIDE_MARGIN + col * (column_width + COLUMN_GAP)

            # Column sub-headers
            header_y = table_top_y
            c.setFont("Helvetica-Bold", 7.5)
            c.drawString(col_x, header_y, "Roll")
            c.drawString(col_x + ROLL_COL_WIDTH + 2 * mm, header_y, "Name")
            c.drawString(col_x + ROLL_COL_WIDTH + NAME_COL_WIDTH + 6 * mm, header_y, "Mark")
            c.line(col_x, header_y - 1.5 * mm, col_x + column_width, header_y - 1.5 * mm)

            for row in range(rows_per_column):
                if idx >= len(students):
                    break
                student = students[idx]
                idx += 1

                row_y_top = table_top_y - 6 * mm - row * ROW_HEIGHT
                text_baseline_y = row_y_top - ROW_HEIGHT + 2.6 * mm

                # Roll number (printed)
                c.setFont("Helvetica", 8.5)
                c.drawString(col_x, text_baseline_y, str(student["roll_number"]))

                # Name (printed)
                c.drawString(col_x + ROLL_COL_WIDTH + 2 * mm, text_baseline_y, student["full_name"])

                # Mark box (empty, bordered) — the cell the OCR pipeline
                # will crop later. Position is recorded in the spec.
                box_x = col_x + ROLL_COL_WIDTH + NAME_COL_WIDTH + 6 * mm
                box_y = row_y_top - ROW_HEIGHT + (ROW_HEIGHT - BOX_SIZE) / 2

                c.setLineWidth(0.75)
                c.rect(box_x, box_y, BOX_SIZE, BOX_SIZE, fill=0, stroke=1)

                spec["cells"].append({
                    "page": page_num,
                    "roll_number": student["roll_number"],
                    "full_name": student["full_name"],
                    "box": {
                        "x0": round(box_x, 2),
                        "y0": round(box_y, 2),
                        "x1": round(box_x + BOX_SIZE, 2),
                        "y1": round(box_y + BOX_SIZE, 2),
                    },
                })

            # row loop may have broken early if students ran out
            if idx >= len(students):
                pass

        c.showPage()

    c.save()

    with open(output_spec_path, "w") as f:
        json.dump(spec, f, indent=2)

    return spec


if __name__ == "__main__":
    # Demo run using the 5 seeded KIPS students. Swap this for a real
    # roster query (e.g. from Supabase) once wiring this into the app.
    students = [
        {"roll_number": "101", "full_name": "Ali Raza"},
        {"roll_number": "102", "full_name": "Sara Khan"},
        {"roll_number": "103", "full_name": "Bilal Ahmed"},
        {"roll_number": "104", "full_name": "Ayesha Malik"},
        {"roll_number": "105", "full_name": "Hamza Sheikh"},
    ]

    generate_sheet(
        students=students,
        school_name="KIPS College",
        section_name="FSc-1st-A",
        attendance_date="",  # left blank on the printed template — filled by hand daily
        output_pdf_path="/home/claude/kaan-template/attendance_sheet_FSc-1st-A.pdf",
        output_spec_path="/home/claude/kaan-template/coords_FSc-1st-A.json",
    )
    print("Generated PDF and coordinate spec.")
