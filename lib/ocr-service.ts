const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL;

type Student = { roll_number: string; full_name: string };

export type SheetSpec = {
  page_size_pt: [number, number];
  fiducial_marker_size_pt: number;
  cells: {
    page: number;
    roll_number: string;
    full_name: string;
    box: { x0: number; y0: number; x1: number; y1: number };
  }[];
};

export type MarkResult = {
  roll_number: string;
  full_name: string;
  status: 'P' | 'A' | 'M' | 'blank' | 'unclear';
  confidence: number;
  needs_review: boolean;
};

function requireServiceUrl(): string {
  if (!OCR_SERVICE_URL) {
    throw new Error(
      'OCR_SERVICE_URL is not set. The OCR microservice (ocr-service/) needs to be deployed ' +
        'separately and its URL added to your environment variables.'
    );
  }
  return OCR_SERVICE_URL;
}

export async function generateSheetPdf(params: {
  students: Student[];
  school_name: string;
  section_name: string;
  attendance_date?: string;
}): Promise<{ pdfBase64: string; spec: SheetSpec }> {
  const res = await fetch(`${requireServiceUrl()}/generate-sheet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw new Error(`OCR service /generate-sheet failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return { pdfBase64: data.pdf_base64, spec: data.spec };
}

export async function generateSpec(params: {
  students: Student[];
  school_name: string;
  section_name: string;
  attendance_date?: string;
}): Promise<SheetSpec> {
  const res = await fetch(`${requireServiceUrl()}/generate-spec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw new Error(`OCR service /generate-spec failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.spec;
}

export async function processSheetImage(
  imageFile: File,
  spec: SheetSpec
): Promise<MarkResult[]> {
  const formData = new FormData();
  formData.append('image', imageFile);
  formData.append('spec', JSON.stringify(spec));

  const res = await fetch(`${requireServiceUrl()}/process-sheet`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    // 422 = marker detection or classification failure — a real,
    // user-facing error ("retake the photo"), not a server bug.
    const detail = await res.text();
    throw new Error(`OCR service /process-sheet failed: ${res.status} ${detail}`);
  }

  const data = await res.json();
  return data.results;
}
