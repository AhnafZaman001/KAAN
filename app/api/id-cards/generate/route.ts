import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';

// Standard ID-card-ish size, laid out in a grid on A4 with cut lines.
const CARD_WIDTH = 242; // ~85mm at 72dpi
const CARD_HEIGHT = 153; // ~54mm at 72dpi
const MARGIN = 20;
const GAP = 12;
const COLS = 2;
const ROWS = 5;

export async function POST(request: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { section_id } = await request.json();
  if (!section_id) {
    return NextResponse.json({ error: 'section_id is required.' }, { status: 400 });
  }

  const { data: section, error: sectionError } = await supabase
    .from('sections')
    .select('id, name, schools(name)')
    .eq('id', section_id)
    .single();

  if (sectionError || !section) {
    return NextResponse.json({ error: 'Section not found.' }, { status: 404 });
  }

  const { data: students, error: studentsError } = await supabase
    .from('students')
    .select('roll_number, full_name, qr_token')
    .eq('section_id', section_id)
    .eq('active', true)
    .order('roll_number');

  if (studentsError || !students || students.length === 0) {
    return NextResponse.json(
      { error: 'No active students found for this section.' },
      { status: 400 }
    );
  }

  const schoolName = (section as any).schools?.name ?? 'School';

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const cardsPerPage = COLS * ROWS;
  const pageWidth = MARGIN * 2 + COLS * CARD_WIDTH + (COLS - 1) * GAP;
  const pageHeight = MARGIN * 2 + ROWS * CARD_HEIGHT + (ROWS - 1) * GAP;

  for (let i = 0; i < students.length; i += cardsPerPage) {
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    const pageStudents = students.slice(i, i + cardsPerPage);

    for (let j = 0; j < pageStudents.length; j++) {
      const student = pageStudents[j];
      const col = j % COLS;
      const row = Math.floor(j / COLS);

      const x = MARGIN + col * (CARD_WIDTH + GAP);
      // PDF origin is bottom-left, so row 0 is the top row
      const y = pageHeight - MARGIN - (row + 1) * CARD_HEIGHT - row * GAP;

      // Card border (cut line)
      page.drawRectangle({
        x,
        y,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        borderColor: rgb(0.7, 0.7, 0.7),
        borderWidth: 0.5,
      });

      const padding = 12;

      // School name
      page.drawText(schoolName, {
        x: x + padding,
        y: y + CARD_HEIGHT - padding - 10,
        size: 9,
        font: boldFont,
        color: rgb(0.09, 0.2, 0.31), // matches --color-ink
      });

      // Section
      page.drawText(section.name, {
        x: x + padding,
        y: y + CARD_HEIGHT - padding - 22,
        size: 7.5,
        font,
        color: rgb(0.36, 0.39, 0.41),
      });

      // Student name (wraps if long — simple truncation for v1)
      const displayName =
        student.full_name.length > 22 ? student.full_name.slice(0, 21) + '…' : student.full_name;
      page.drawText(displayName, {
        x: x + padding,
        y: y + padding + 26,
        size: 11,
        font: boldFont,
        color: rgb(0.1, 0.11, 0.12),
      });

      // Roll number
      page.drawText(`Roll: ${student.roll_number}`, {
        x: x + padding,
        y: y + padding + 12,
        size: 8.5,
        font,
        color: rgb(0.36, 0.39, 0.41),
      });

      // QR code — encodes the opaque token, not the student's real ID
      const qrDataUrl = await QRCode.toDataURL(student.qr_token, {
        margin: 0,
        width: 256,
      });
      const qrImageBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64');
      const qrImage = await pdfDoc.embedPng(qrImageBytes);

      const qrSize = 72;
      page.drawImage(qrImage, {
        x: x + CARD_WIDTH - padding - qrSize,
        y: y + padding,
        width: qrSize,
        height: qrSize,
      });
    }
  }

  const pdfBytes = await pdfDoc.save();

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="id_cards_${section.name}.pdf"`,
    },
  });
}
