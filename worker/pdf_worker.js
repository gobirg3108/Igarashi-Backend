const fs = require("fs");
const path = require("path");
const os = require("os");
const PDFDocument = require("pdfkit");
const { parentPort } = require("worker_threads");

const pad = (value) => String(value).padStart(2, "0");

const getLocalDateFolderName = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const formatGeneratedAt = (date = new Date()) =>
  new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);

const splitDateTime = (value) => {
  if (value === null || value === undefined || value === "") {
    return { date: "", time: "" };
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      date: `${pad(value.getDate())}-${pad(value.getMonth() + 1)}-${value.getFullYear()}`,
      time: `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`,
    };
  }

  const raw = String(value).trim().replace(/Z$/, "");
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}:\d{2}:\d{2})/);

  if (match) {
    return { date: `${match[3]}-${match[2]}-${match[1]}`, time: match[4] };
  }

  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return { date: `${dateOnly[3]}-${dateOnly[2]}-${dateOnly[1]}`, time: "" };
  }

  return { date: raw, time: "" };
};

const formatDateInput = (value) => {
  if (!value) return "";
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : raw;
};

const formatValue = (value) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const dt = splitDateTime(value);
    return `${dt.date} ${dt.time}`.trim();
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value).trim();
};

const friendlyHeader = (header) => String(header || "").replace(/_/g, " ");

const buildHeaders = (row, styledHeaders) => {
  const result = [];

  if (Array.isArray(styledHeaders) && styledHeaders.length) {
    styledHeaders.forEach((header) => {
      const type = String(header?.type || "NORMAL").toUpperCase();
      const base = {
        key: header?.original,
        label: header?.label || friendlyHeader(header?.original),
        type: type.toLowerCase(),
      };

      if (type === "DATETIME") {
        result.push({ ...base, label: "Date", type: "date" });
        result.push({ ...base, label: "Time", type: "time" });
      } else {
        result.push(base);
      }
    });

    return result;
  }

  Object.keys(row || {}).forEach((key) => {
    if (String(key).toLowerCase() === "date_time") {
      result.push({ key, label: "Date", type: "date" });
      result.push({ key, label: "Time", type: "time" });
    } else {
      result.push({ key, label: friendlyHeader(key), type: "normal" });
    }
  });

  return result;
};

const getHeaderValue = (row, header) => {
  const value = row?.[header.key];
  if (header.type === "date" || header.type === "time") {
    const dt = splitDateTime(value);
    return header.type === "date" ? dt.date : dt.time;
  }
  return formatValue(value);
};

const safeFilePart = (value) =>
  String(value || "REPORT")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);

const createPDF = async (data, result, styledHeaders) => {
  if (!Array.isArray(result) || !result.length) return "No data to export";

  const orientation =
    String(data?.orientation || "landscape").toLowerCase() === "portrait"
      ? "portrait"
      : "landscape";

  const fallbackRoot = path.join(os.homedir(), "Documents", "Igarashi", "Backup");
  const backupRoot =
    typeof data?.outputRoot === "string" && data.outputRoot.trim()
      ? path.resolve(data.outputRoot)
      : fallbackRoot;
  const backupFolder = path.join(backupRoot, getLocalDateFolderName(), "DOWNLOAD");
  fs.mkdirSync(backupFolder, { recursive: true });

  const fileName = `${safeFilePart(data?.machine)}_${orientation}_${Date.now()}.pdf`;
  const filePath = path.join(backupFolder, fileName);

  const PAGE_MARGIN = 20;
  const FOOTER_RESERVED = 42;
  const HEADER_BLUE = "#1976D2";
  const BORDER = "#C9D2DC";
  const LIGHT_ROW = "#F7F9FC";
  const generatedAt = formatGeneratedAt();
  const headers = buildHeaders(result[0], styledHeaders);

  if (!headers.length) throw new Error("No columns available for PDF export");

  const reportType = String(data?.reportType || "MACHINE DATA").trim();
  const machineName = String(data?.machine || "Machine").trim();
  const shiftName = String(data?.shift || "All").trim();
  const fromDate = formatDateInput(data?.fromDate);
  const toDate = formatDateInput(data?.toDate);
  const fromTime = String(data?.from_time || "").trim();
  const toTime = String(data?.to_time || "").trim();
  const templateName = String(data?.getSelTemplate || "").trim();

  const doc = new PDFDocument({
    size: "A4",
    layout: orientation,
    margins: {
      top: PAGE_MARGIN,
      bottom: PAGE_MARGIN,
      left: PAGE_MARGIN,
      right: PAGE_MARGIN,
    },
    autoFirstPage: false,
    bufferPages: true,
    info: {
      Title: `${machineName} Report`,
      Author: "Igarashi Motors India Ltd.",
      Subject: `${reportType} Report`,
    },
  });

  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  let currentY = 0;
  let currentSectionTitle = machineName;

  const pageUsableWidth = () =>
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const contentBottom = () => doc.page.height - FOOTER_RESERVED;

  const drawReportHeader = () => {
    const left = doc.page.margins.left;
    const width = pageUsableWidth();
    const topY = doc.page.margins.top;

    if (data?.logoPath && fs.existsSync(data.logoPath)) {
      try {
        doc.image(data.logoPath, left, topY, { fit: [88, 34] });
      } catch (error) {
        console.warn("PDF logo skipped:", error.message);
      }
    }

    doc
      .font("Helvetica-Bold")
      .fontSize(orientation === "landscape" ? 14 : 13)
      .fillColor("#111111")
      .text("IGARASHI MOTORS INDIA LTD.", left + 100, topY + 2, {
        width: Math.max(100, width - 200),
        align: "center",
      });

    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(`${reportType.toUpperCase()} REPORT`, left + 100, topY + 21, {
        width: Math.max(100, width - 200),
        align: "center",
      });

    const detailWidth = width / 2 - 5;
    doc.font("Helvetica").fontSize(8).fillColor("#333333");
    doc.text(`Machine: ${machineName}`, left, topY + 45, { width: detailWidth });
    doc.text(`Generated: ${generatedAt}`, left + width / 2, topY + 45, {
      width: detailWidth,
      align: "right",
    });
    doc.text(`Date: ${fromDate}${toDate && toDate !== fromDate ? ` to ${toDate}` : ""}`, left, topY + 58, {
      width: detailWidth,
    });
    doc.text(`Shift: ${shiftName}`, left + width / 2, topY + 58, {
      width: detailWidth,
      align: "right",
    });
    doc.text(`Time: ${fromTime || "--:--"} to ${toTime || "--:--"}`, left, topY + 71, {
      width: detailWidth,
    });
    doc.text(`Orientation: ${orientation === "portrait" ? "Portrait" : "Landscape"}`, left + width / 2, topY + 71, {
      width: detailWidth,
      align: "right",
    });

    if (templateName && templateName !== "select" && templateName !== "No-Template") {
      doc.text(`Template: ${templateName}`, left, topY + 84, { width });
    }

    const lineY = topY + (templateName && templateName !== "select" && templateName !== "No-Template" ? 100 : 88);
    doc
      .moveTo(left, lineY)
      .lineTo(doc.page.width - doc.page.margins.right, lineY)
      .strokeColor("#777777")
      .lineWidth(0.7)
      .stroke();

    return lineY + 10;
  };

  const drawSectionTitle = (title, continued = false) => {
    const left = doc.page.margins.left;
    doc
      .font("Helvetica-Bold")
      .fontSize(orientation === "landscape" ? 11 : 10.5)
      .fillColor("#111111")
      .text(`${title}${continued ? " (continued)" : ""}`, left, currentY, {
        width: pageUsableWidth(),
      });
    currentY += 18;
  };

  const newPage = (continued = false) => {
    doc.addPage();
    currentY = drawReportHeader();
    drawSectionTitle(currentSectionTitle, continued);
  };

  const ensureSpace = (heightNeeded) => {
    if (currentY + heightNeeded <= contentBottom()) return false;
    newPage(true);
    return true;
  };

  const calculateLandscapeRowHeight = (chunkHeaders, row, colWidth) => {
    const innerWidth = Math.max(10, colWidth - 6);
    doc.font("Helvetica").fontSize(6.5);
    let height = 20;

    chunkHeaders.forEach((header) => {
      const value = getHeaderValue(row, header);
      const textHeight = doc.heightOfString(String(value ?? ""), {
        width: innerWidth,
      });
      height = Math.max(height, Math.min(38, textHeight + 7));
    });

    return height;
  };

  const drawLandscapeHeader = (chunkHeaders) => {
    const left = doc.page.margins.left;
    const colWidth = pageUsableWidth() / chunkHeaders.length;
    const height = 24;

    chunkHeaders.forEach((header, index) => {
      const x = left + index * colWidth;
      doc.rect(x, currentY, colWidth, height).fillAndStroke(HEADER_BLUE, BORDER);
      doc
        .font("Helvetica-Bold")
        .fontSize(6.6)
        .fillColor("#FFFFFF")
        .text(header.label, x + 3, currentY + 5, {
          width: colWidth - 6,
          height: height - 7,
          ellipsis: true,
        });
    });

    currentY += height;
    return colWidth;
  };

  const drawLandscapeRow = (chunkHeaders, row, colWidth, rowIndex, rowHeight) => {
    const left = doc.page.margins.left;
    const fill = rowIndex % 2 === 0 ? "#FFFFFF" : LIGHT_ROW;

    chunkHeaders.forEach((header, index) => {
      const x = left + index * colWidth;
      const value = getHeaderValue(row, header);
      doc.rect(x, currentY, colWidth, rowHeight).fillAndStroke(fill, BORDER);
      doc
        .font("Helvetica")
        .fontSize(6.5)
        .fillColor("#111111")
        .text(String(value ?? ""), x + 3, currentY + 4, {
          width: colWidth - 6,
          height: rowHeight - 6,
          ellipsis: true,
        });
    });

    currentY += rowHeight;
  };

  const renderLandscape = () => {
    const MAX_COLS = 8;
    const chunks = [];
    for (let index = 0; index < headers.length; index += MAX_COLS) {
      chunks.push(headers.slice(index, index + MAX_COLS));
    }

    newPage(false);

    chunks.forEach((chunkHeaders, chunkIndex) => {
      if (chunkIndex > 0) currentY += 7;

      const firstRowHeight = calculateLandscapeRowHeight(
        chunkHeaders,
        result[0],
        pageUsableWidth() / chunkHeaders.length,
      );
      ensureSpace(24 + firstRowHeight + 4);
      let colWidth = drawLandscapeHeader(chunkHeaders);

      result.forEach((row, rowIndex) => {
        const rowHeight = calculateLandscapeRowHeight(chunkHeaders, row, colWidth);
        const pageChanged = ensureSpace(rowHeight + 2);
        if (pageChanged) colWidth = drawLandscapeHeader(chunkHeaders);
        drawLandscapeRow(chunkHeaders, row, colWidth, rowIndex, rowHeight);
      });
    });
  };

  const drawPortraitTableHeader = () => {
    const left = doc.page.margins.left;
    const width = pageUsableWidth();
    const parameterWidth = Math.round(width * 0.46);
    const valueWidth = width - parameterWidth;
    const height = 22;

    doc.rect(left, currentY, parameterWidth, height).fillAndStroke(HEADER_BLUE, BORDER);
    doc.rect(left + parameterWidth, currentY, valueWidth, height).fillAndStroke(HEADER_BLUE, BORDER);
    doc
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .fillColor("#FFFFFF")
      .text("Parameter", left + 4, currentY + 6, { width: parameterWidth - 8 })
      .text("Value", left + parameterWidth + 4, currentY + 6, { width: valueWidth - 8 });

    currentY += height;
    return { parameterWidth, valueWidth };
  };

  const calculatePortraitRowHeight = (label, value, parameterWidth, valueWidth) => {
    doc.font("Helvetica").fontSize(7.5);
    const labelHeight = doc.heightOfString(label, { width: parameterWidth - 8 });
    const valueHeight = doc.heightOfString(String(value ?? ""), { width: valueWidth - 8 });
    return Math.max(19, Math.min(46, Math.max(labelHeight, valueHeight) + 8));
  };

  const drawPortraitRow = (label, value, parameterWidth, valueWidth, rowIndex, rowHeight) => {
    const left = doc.page.margins.left;
    const fill = rowIndex % 2 === 0 ? "#FFFFFF" : LIGHT_ROW;
    const isFinalResult = String(label).toLowerCase() === "final result";
    const valueText = String(value ?? "");
    const resultOk = isFinalResult && valueText.toUpperCase() === "OK";

    doc.rect(left, currentY, parameterWidth, rowHeight).fillAndStroke(fill, BORDER);
    doc
      .rect(left + parameterWidth, currentY, valueWidth, rowHeight)
      .fillAndStroke(resultOk ? "#E9F7EF" : fill, BORDER);

    doc
      .font(isFinalResult ? "Helvetica-Bold" : "Helvetica")
      .fontSize(7.5)
      .fillColor("#111111")
      .text(label, left + 4, currentY + 5, {
        width: parameterWidth - 8,
        height: rowHeight - 7,
      })
      .text(valueText, left + parameterWidth + 4, currentY + 5, {
        width: valueWidth - 8,
        height: rowHeight - 7,
      });

    currentY += rowHeight;
  };

  const renderPortrait = () => {
    newPage(false);

    result.forEach((row, recordIndex) => {
      if (result.length > 1) {
        ensureSpace(18 + 22 + 20);
        doc
          .font("Helvetica-Bold")
          .fontSize(8.5)
          .fillColor("#333333")
          .text(`Record ${recordIndex + 1}`, doc.page.margins.left, currentY, {
            width: pageUsableWidth(),
          });
        currentY += 16;
      }

      ensureSpace(22 + 20);
      let widths = drawPortraitTableHeader();

      headers.forEach((header, headerIndex) => {
        const label = header.label;
        const value = getHeaderValue(row, header);
        const rowHeight = calculatePortraitRowHeight(
          label,
          value,
          widths.parameterWidth,
          widths.valueWidth,
        );

        const pageChanged = ensureSpace(rowHeight + 2);
        if (pageChanged) {
          if (result.length > 1) {
            doc
              .font("Helvetica-Bold")
              .fontSize(8)
              .fillColor("#555555")
              .text(`Record ${recordIndex + 1} (continued)`, doc.page.margins.left, currentY, {
                width: pageUsableWidth(),
              });
            currentY += 15;
          }
          widths = drawPortraitTableHeader();
        }

        drawPortraitRow(
          label,
          value,
          widths.parameterWidth,
          widths.valueWidth,
          headerIndex,
          rowHeight,
        );
      });

      currentY += 10;
    });
  };

  if (orientation === "portrait") renderPortrait();
  else renderLandscape();

  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    const footerY = doc.page.height - 31;
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#555555")
      .text(`Page ${pageIndex - range.start + 1} of ${range.count}`, doc.page.margins.left, footerY, {
        width: pageUsableWidth(),
        align: "right",
        lineBreak: false,
      });
  }

  doc.end();

  await new Promise((resolve, reject) => {
    stream.once("finish", resolve);
    stream.once("error", reject);
  });

  const stats = fs.statSync(filePath);
  if (!stats.isFile() || stats.size <= 0) throw new Error("PDF file was not created correctly");

  return filePath;
};

parentPort.on("message", async ({ data, result, styledHeaders }) => {
  try {
    const filePath = await createPDF(data || {}, result || [], styledHeaders || null);
    parentPort.postMessage(filePath);
  } catch (error) {
    parentPort.postMessage(error?.message || "PDF export failed");
  }
});
