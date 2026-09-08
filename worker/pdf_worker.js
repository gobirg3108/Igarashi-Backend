// pdf_worker.js - Complete worker with Date/Time mapping and styling

const fs = require("fs");
const PDFDocument = require("pdfkit");
const path = require("path");
const os = require("os");
const { parentPort } = require("worker_threads");

const getLocalDateFolderName = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// --------------------------------------------------
// DATE FIX FUNCTION - NO TIMEZONE CONVERSION
// --------------------------------------------------
const formatDateTime = (value) => {
  if (!value) {
    return { date: "", time: "" };
  }

  let str = "";

  if (value instanceof Date) {
    str = value.toISOString();
  } else {
    str = String(value).trim();
  }

  // Remove UTC "Z" marker to avoid timezone shift
  str = str.replace("Z", "");

  const dateStr = str.substring(0, 10); // "2026-04-17"
  const timeStr = str.substring(11, 19); // "08:05:00"

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(dateStr) &&
    /^\d{2}:\d{2}:\d{2}$/.test(timeStr)
  ) {
    return { date: dateStr, time: timeStr };
  }

  return { date: "", time: "" };
};

// --------------------------------------------------
// MAIN PDF WITH STYLING
// --------------------------------------------------
const createPDF = async (data, result, styledHeaders) => {
  if (!result?.length) return "No data to export";

  const fallbackRoot = path.join(
    os.homedir(),
    "Documents",
    "Igarashi",
    "Backup",
  );
  const backupRoot =
    typeof data?.outputRoot === "string" && data.outputRoot.trim()
      ? path.resolve(data.outputRoot)
      : fallbackRoot;
  const todayFolder = getLocalDateFolderName();
  const backupFolder = path.join(backupRoot, todayFolder, "DOWNLOAD");

  if (!fs.existsSync(backupFolder)) {
    fs.mkdirSync(backupFolder, { recursive: true });
  }

  const fileName = `${data.machine.slice(0, 25)}_${Date.now()}.pdf`;
  const filePath = path.join(backupFolder, fileName);

  const doc = new PDFDocument({
    margin: 15,
    size: "A4",
    layout: "landscape",
  });

  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // --------------------------------------------------
  // BUILD HEADERS
  // --------------------------------------------------
  let headers = [];

  if (styledHeaders && styledHeaders.length) {
    // --------------------------------------------------
    // TEMPLATE MODE:
    // Expand DATETIME type into two rows (Date + Time).
    // DATE and TIME types from api.js pass through as-is.
    // --------------------------------------------------
    styledHeaders.forEach((h) => {
      if (h.type === "DATETIME") {
        // Split into Date row
        headers.push({ ...h, label: "Date", type: "DATE" });
        // Split into Time row
        headers.push({ ...h, label: "Time", type: "TIME" });
      } else {
        // DATE, TIME, NORMAL — already correctly mapped in api.js
        headers.push(h);
      }
    });
  } else {
    // --------------------------------------------------
    // NO TEMPLATE MODE: original fallback logic (unchanged)
    // --------------------------------------------------
    let dbHeaders = Object.keys(result[0]);
    const hasDateTime = dbHeaders.some((x) => x.toLowerCase() === "date_time");

    if (hasDateTime) {
      const dateTimeKey = dbHeaders.find(
        (x) => x.toLowerCase() === "date_time"
      );

      headers.push({
        original: dateTimeKey,
        label: "Date",
        header_bg: "#ffffff",
        header_text: "#000000",
        content_bg: "#ffffff",
        content_text: "#000000",
        type: "DATE",
      });

      headers.push({
        original: dateTimeKey,
        label: "Time",
        header_bg: "#ffffff",
        header_text: "#000000",
        content_bg: "#ffffff",
        content_text: "#000000",
        type: "TIME",
      });

      dbHeaders = dbHeaders.filter((x) => x.toLowerCase() !== "date_time");
    }

    dbHeaders.forEach((col) => {
      headers.push({
        original: col,
        label: col,
        header_bg: "#ffffff",
        header_text: "#000000",
        content_bg: "#ffffff",
        content_text: "#000000",
        type: "NORMAL",
      });
    });
  }

  // --------------------------------------------------
  // COLUMN SPLIT (MAX 8 COLUMNS PER PAGE)
  // --------------------------------------------------
  const MAX_COLS = 8;
  const chunks = [];

  for (let i = 0; i < headers.length; i += MAX_COLS) {
    chunks.push(headers.slice(i, i + MAX_COLS));
  }

  // --------------------------------------------------
  // TITLE
  // --------------------------------------------------
  doc.font("Helvetica-Bold").fontSize(18).text(`${data.machine} Report`, {
    align: "center",
  });

  doc.moveDown(1.5);

  // --------------------------------------------------
  // RENDER PAGES WITH STYLING
  // --------------------------------------------------
  chunks.forEach((chunk, pageIndex) => {
    if (pageIndex !== 0) doc.addPage();

    let y = doc.y;
    const usableWidth = doc.page.width - 30;
    const colWidth = usableWidth / chunk.length;
    const cellHeight = 20;
    const borderColor = "#cccccc";

    // HEADER ROW
    chunk.forEach((h, i) => {
      const x = 15 + i * colWidth;

      doc.rect(x, y, colWidth, cellHeight);
      doc.fillColor(h.header_bg).fill();
      doc.strokeColor(borderColor).lineWidth(0.5).stroke();

      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(h.header_text)
        .text(h.label, x + 5, y + 5, {
          width: colWidth - 10,
          height: cellHeight - 10,
          align: "left",
          valign: "center",
        });
    });

    y += cellHeight;

    // DATA ROWS
    doc.font("Helvetica").fontSize(9);

    result.forEach((row) => {
      if (y > doc.page.height - 40) {
        doc.addPage();
        y = 30;

        // Redraw header on new page
        chunk.forEach((h, i) => {
          const x = 15 + i * colWidth;

          doc.rect(x, y, colWidth, cellHeight);
          doc.fillColor(h.header_bg).fill();
          doc.strokeColor(borderColor).lineWidth(0.5).stroke();

          doc
            .font("Helvetica-Bold")
            .fontSize(10)
            .fillColor(h.header_text)
            .text(h.label, x + 5, y + 5, {
              width: colWidth - 10,
              height: cellHeight - 10,
              align: "left",
              valign: "center",
            });
        });

        y += cellHeight;
        doc.font("Helvetica").fontSize(9);
      }

      chunk.forEach((h, i) => {
        const x = 15 + i * colWidth;
        let value = row[h.original];

        // --------------------------------------------------
        // DATE / TIME SPLIT — works for both template & no-template
        // --------------------------------------------------
        if (h.type === "DATE" || h.type === "TIME") {
          const dt = formatDateTime(value);
          value = h.type === "DATE" ? dt.date : dt.time;
        }

        doc.rect(x, y, colWidth, cellHeight);
        doc.fillColor(h.content_bg).fill();
        doc.strokeColor(borderColor).lineWidth(0.5).stroke();

        doc
          .fillColor(h.content_text)
          .text(String(value ?? ""), x + 5, y + 5, {
            width: colWidth - 10,
            height: cellHeight - 10,
            align: "left",
            valign: "center",
          });
      });

      y += cellHeight;
    });
  });

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return filePath;
};

// --------------------------------------------------
// WORKER MESSAGE HANDLER
// --------------------------------------------------
parentPort.on("message", async ({ data, result, styledHeaders }) => {
  try {
    const filePath = await createPDF(data, result, styledHeaders);
    parentPort.postMessage(filePath);
  } catch (error) {
    parentPort.postMessage(error.message);
  }
});