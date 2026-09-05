"""
KAAN OCR Service
==================
Small FastAPI wrapper around pipeline.py (OCR) and generate_template.py
(printable sheet generation). Exists as a separate service from the
Next.js app because OpenCV + reportlab need a real Python runtime —
Vercel's Next.js functions don't support that natively.

Endpoints:
  GET  /health           — liveness check
  POST /generate-sheet   — roster in, printable PDF + coordinate spec out
  POST /generate-spec    — roster in, coordinate spec only (no PDF render,
                            used when re-scanning a sheet that was already
                            printed — we just need matching coordinates)
  POST /process-sheet    — photo + spec in, per-student P/A/M readings out

Deploy: see README.md for Render/Railway/Fly instructions.
"""

import base64
import json
import tempfile
import os
from typing import List, Optional

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from generate_template import generate_sheet
from pipeline import process_sheet

app = FastAPI(title="KAAN OCR Service")

# Locked down to the Next.js app's origin via env var in production —
# see README.md. Defaults open for local development only.
allowed_origins = os.environ.get("ALLOWED_ORIGIN", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[allowed_origins] if allowed_origins != "*" else ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Student(BaseModel):
    roll_number: str
    full_name: str


class GenerateRequest(BaseModel):
    students: List[Student]
    school_name: str
    section_name: str
    attendance_date: Optional[str] = ""


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/generate-sheet")
def generate_sheet_endpoint(req: GenerateRequest):
    """Returns a printable PDF (base64) + its coordinate spec."""
    with tempfile.TemporaryDirectory() as tmp:
        pdf_path = os.path.join(tmp, "sheet.pdf")
        spec_path = os.path.join(tmp, "spec.json")

        spec = generate_sheet(
            students=[s.model_dump() for s in req.students],
            school_name=req.school_name,
            section_name=req.section_name,
            attendance_date=req.attendance_date or "",
            output_pdf_path=pdf_path,
            output_spec_path=spec_path,
        )

        with open(pdf_path, "rb") as f:
            pdf_b64 = base64.b64encode(f.read()).decode("utf-8")

    return {"pdf_base64": pdf_b64, "spec": spec}


@app.post("/generate-spec")
def generate_spec_endpoint(req: GenerateRequest):
    """
    Same coordinate math as /generate-sheet, but skips PDF rendering —
    used when a sheet was already printed earlier and we just need a
    matching spec to interpret a photo of it. Roster order/count must
    match what was printed, or coordinates won't line up.
    """
    with tempfile.TemporaryDirectory() as tmp:
        pdf_path = os.path.join(tmp, "sheet.pdf")  # generate_sheet always renders a PDF; discarded here
        spec_path = os.path.join(tmp, "spec.json")

        spec = generate_sheet(
            students=[s.model_dump() for s in req.students],
            school_name=req.school_name,
            section_name=req.section_name,
            attendance_date=req.attendance_date or "",
            output_pdf_path=pdf_path,
            output_spec_path=spec_path,
        )

    return {"spec": spec}


@app.post("/process-sheet")
async def process_sheet_endpoint(
    image: UploadFile = File(...),
    spec: str = Form(...),
):
    """
    image: the photographed sheet (JPG/PNG)
    spec: JSON string — the coordinate spec matching this sheet's roster
    """
    try:
        spec_dict = json.loads(spec)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="spec is not valid JSON")

    with tempfile.TemporaryDirectory() as tmp:
        image_path = os.path.join(tmp, "photo.jpg")
        spec_path = os.path.join(tmp, "spec.json")

        with open(image_path, "wb") as f:
            f.write(await image.read())
        with open(spec_path, "w") as f:
            json.dump(spec_dict, f)

        try:
            results = process_sheet(image_path, spec_path)
        except ValueError as e:
            # Marker detection failure, bad image, etc. — a clear
            # error the frontend can show ("retake the photo"),
            # not a 500.
            raise HTTPException(status_code=422, detail=str(e))

    return {"results": results}
