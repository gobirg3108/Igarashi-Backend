const fs = require("fs");
const path = require("path");
const os = require("os");
const PDFDocument = require("pdfkit");
const { parentPort } = require("worker_threads");

const getLocalDateFolderName = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

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

const pad = (value) => String(value).padStart(2, "0");

const splitDateTime = (value) => {
  if (value === null || value === undefined || value === "") {
    return { date: "", time: "" };
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
      time: `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`,
    };
  }

  const raw = String(value).trim().replace("Z", "");
  const match = raw.match(
    /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2})/,
  );

  if (match) {
    return { date: match[1], time: match[2] };
  }

  return { date: raw, time: "" };
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

const buildHeaders = (row) => {
  const result = [];

  Object.keys(row || {}).forEach((key) => {
    if (key.toLowerCase() === "date_time") {
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
  String(value || "DMC")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);

const createTraceabilityPdf = async ({
  dmcCode,
  sections,
  traceabilityRoot,
  logoPath,
  orientation,
}) => {
  const validSections = (Array.isArray(sections) ? sections : []).filter(
    (item) => Array.isArray(item?.data) && item.data.length > 0,
  );

  if (!validSections.length) {
    throw new Error("No traceability data found for PDF export");
  }

  const pdfOrientation =
    String(orientation || "landscape").toLowerCase() === "portrait"
      ? "portrait"
      : "landscape";

  const fallbackRoot = path.join(
    os.homedir(),
    "Documents",
    "Igarashi",
    "Traceability",
  );
  const root =
    typeof traceabilityRoot === "string" && traceabilityRoot.trim()
      ? path.resolve(traceabilityRoot)
      : fallbackRoot;

  const todayFolder = path.join(root, getLocalDateFolderName());
  fs.mkdirSync(todayFolder, { recursive: true });

  const fileName = `DMC_TRACEABILITY_${safeFilePart(dmcCode)}_${pdfOrientation}_${Date.now()}.pdf`;
  const filePath = path.join(todayFolder, fileName);

  const PAGE_MARGIN = 20;
  const FOOTER_RESERVED = 42;
  const HEADER_BLUE = "#1976D2";
  const BORDER = "#C9D2DC";
  const LIGHT_ROW = "#F7F9FC";
  const generatedAt = formatGeneratedAt();

  const doc = new PDFDocument({
    size: "A4",
    layout: pdfOrientation,
    margins: {
      top: PAGE_MARGIN,
      bottom: PAGE_MARGIN,
      left: PAGE_MARGIN,
      right: PAGE_MARGIN,
    },
    autoFirstPage: false,
    bufferPages: true,
    info: {
      Title: `Traceability Report - ${dmcCode}`,
      Author: "Igarashi Motors India Ltd.",
      Subject: "DMC Traceability Report",
    },
  });

  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  let currentY = 0;
  let currentSectionTitle = "";

  const pageUsableWidth = () =>
    doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const contentBottom = () => doc.page.height - FOOTER_RESERVED;

  const drawReportHeader = () => {
    const left = doc.page.margins.left;
    const width = pageUsableWidth();
    let topY = doc.page.margins.top;

    if (logoPath && fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, left, topY, { fit: [88, 34] });
      } catch (error) {
        console.warn("Traceability PDF logo skipped:", error.message);
      }
    }

    doc
      .font("Helvetica-Bold")
      .fontSize(pdfOrientation === "landscape" ? 14 : 13)
      .fillColor("#111111")
      .text("IGARASHI MOTORS INDIA LTD.", left + 100, topY + 2, {
        width: width - 200,
        align: "center",
      });

    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("TRACEABILITY REPORT", left + 100, topY + 21, {
        width: width - 200,
        align: "center",
      });

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#333333")
      .text(`DMC Code: ${dmcCode}`, left, topY + 44)
      .text(`Generated: ${generatedAt}`, left, topY + 57)
      .text(
        `Orientation: ${pdfOrientation === "portrait" ? "Portrait" : "Landscape"}`,
        left,
        topY + 70,
      );

    const lineY = topY + 86;
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
    const width = pageUsableWidth();
    const label = `${title}${continued ? " (continued)" : ""}`;

    doc
      .font("Helvetica-Bold")
      .fontSize(pdfOrientation === "landscape" ? 11 : 10.5)
      .fillColor("#111111")
      .text(label, left, currentY, { width });

    currentY += 18;
  };

  const newPage = (sectionTitle = "", continued = false) => {
    doc.addPage();
    currentY = drawReportHeader();
    currentSectionTitle = sectionTitle || "";
    if (sectionTitle) drawSectionTitle(sectionTitle, continued);
  };

  const ensureSpace = (heightNeeded, sectionTitle = currentSectionTitle) => {
    if (currentY + heightNeeded <= contentBottom()) return false;
    newPage(sectionTitle, Boolean(sectionTitle));
    return true;
  };

  const calculateLandscapeRowHeight = (headers, row, colWidth) => {
    const innerWidth = Math.max(10, colWidth - 6);
    doc.font("Helvetica").fontSize(6.5);
    let height = 20;

    headers.forEach((header) => {
      const value = getHeaderValue(row, header);
      const textHeight = doc.heightOfString(String(value ?? ""), {
        width: innerWidth,
        align: "left",
      });
      height = Math.max(height, Math.min(38, textHeight + 7));
    });

    return height;
  };

  const drawLandscapeHeader = (headers) => {
    const left = doc.page.margins.left;
    const usableWidth = pageUsableWidth();
    const colWidth = usableWidth / headers.length;
    const height = 24;

    headers.forEach((header, index) => {
      const x = left + index * colWidth;
      doc.rect(x, currentY, colWidth, height).fillAndStroke(HEADER_BLUE, BORDER);
      doc
        .font("Helvetica-Bold")
        .fontSize(6.6)
        .fillColor("#FFFFFF")
        .text(header.label, x + 3, currentY + 5, {
          width: colWidth - 6,
          height: height - 7,
          align: "left",
          ellipsis: true,
        });
    });

    currentY += height;
    return colWidth;
  };

  const drawLandscapeRow = (headers, row, colWidth, rowIndex, rowHeight) => {
    const left = doc.page.margins.left;
    const fill = rowIndex % 2 === 0 ? "#FFFFFF" : LIGHT_ROW;

    headers.forEach((header, index) => {
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
          align: "left",
          ellipsis: true,
        });
    });

    currentY += rowHeight;
  };

  const renderLandscapeSection = (section) => {
    const sectionTitle = section.table || section.machinename || "Traceability";
    const allHeaders = buildHeaders(section.data[0]);
    const MAX_COLS = 8;
    const chunks = [];

    for (let i = 0; i < allHeaders.length; i += MAX_COLS) {
      chunks.push(allHeaders.slice(i, i + MAX_COLS));
    }

    if (!doc.page) {
      newPage(sectionTitle, false);
    } else {
      ensureSpace(18 + 24 + 24, "");
      currentSectionTitle = sectionTitle;
      drawSectionTitle(sectionTitle, false);
    }

    chunks.forEach((headers, chunkIndex) => {
      if (chunkIndex > 0) currentY += 7;

      // Keep each field band on the same page when possible. If it does not fit,
      // continue the same machine on the next page instead of creating a page per band.
      const firstRowHeight = section.data.length
        ? calculateLandscapeRowHeight(
            headers,
            section.data[0],
            pageUsableWidth() / headers.length,
          )
        : 20;

      ensureSpace(24 + firstRowHeight + 4, sectionTitle);
      let colWidth = drawLandscapeHeader(headers);

      section.data.forEach((row, rowIndex) => {
        const rowHeight = calculateLandscapeRowHeight(
          headers,
          row,
          colWidth,
        );

        const pageChanged = ensureSpace(rowHeight + 2, sectionTitle);
        if (pageChanged) {
          colWidth = drawLandscapeHeader(headers);
        }

        drawLandscapeRow(headers, row, colWidth, rowIndex, rowHeight);
      });
    });

    currentY += 14;
  };

  const drawPortraitTableHeader = () => {
    const left = doc.page.margins.left;
    const width = pageUsableWidth();
    const parameterWidth = Math.round(width * 0.46);
    const valueWidth = width - parameterWidth;
    const height = 22;

    doc.rect(left, currentY, parameterWidth, height).fillAndStroke(HEADER_BLUE, BORDER);
    doc
      .rect(left + parameterWidth, currentY, valueWidth, height)
      .fillAndStroke(HEADER_BLUE, BORDER);

    doc
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .fillColor("#FFFFFF")
      .text("Parameter", left + 4, currentY + 6, {
        width: parameterWidth - 8,
      })
      .text("Value", left + parameterWidth + 4, currentY + 6, {
        width: valueWidth - 8,
      });

    currentY += height;
    return { parameterWidth, valueWidth };
  };

  const calculatePortraitRowHeight = (label, value, parameterWidth, valueWidth) => {
    doc.font("Helvetica").fontSize(7.5);
    const labelHeight = doc.heightOfString(label, {
      width: parameterWidth - 8,
    });
    const valueHeight = doc.heightOfString(String(value ?? ""), {
      width: valueWidth - 8,
    });
    return Math.max(19, Math.min(46, Math.max(labelHeight, valueHeight) + 8));
  };

  const drawPortraitRow = (
    label,
    value,
    parameterWidth,
    valueWidth,
    rowIndex,
    rowHeight,
  ) => {
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

  const renderPortraitSection = (section) => {
    const sectionTitle = section.table || section.machinename || "Traceability";
    const headers = buildHeaders(section.data[0]);

    if (!doc.page) {
      newPage(sectionTitle, false);
    } else {
      ensureSpace(18 + 22 + 24, "");
      currentSectionTitle = sectionTitle;
      drawSectionTitle(sectionTitle, false);
    }

    section.data.forEach((row, recordIndex) => {
      if (section.data.length > 1) {
        ensureSpace(18 + 22 + 20, sectionTitle);
        doc
          .font("Helvetica-Bold")
          .fontSize(8.5)
          .fillColor("#333333")
          .text(`Record ${recordIndex + 1}`, doc.page.margins.left, currentY, {
            width: pageUsableWidth(),
          });
        currentY += 16;
      }

      ensureSpace(22 + 20, sectionTitle);
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

        const pageChanged = ensureSpace(rowHeight + 2, sectionTitle);
        if (pageChanged) {
          if (section.data.length > 1) {
            doc
              .font("Helvetica-Bold")
              .fontSize(8)
              .fillColor("#555555")
              .text(
                `Record ${recordIndex + 1} (continued)`,
                doc.page.margins.left,
                currentY,
                { width: pageUsableWidth() },
              );
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

      currentY += 9;
    });

    currentY += 8;
  };

  validSections.forEach((section) => {
    if (pdfOrientation === "portrait") {
      renderPortraitSection(section);
    } else {
      renderLandscapeSection(section);
    }
  });

  // Add page numbers inside the reserved footer area. The y-position stays above
  // PDFKit's bottom margin so writing the footer cannot create extra blank pages.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const footerY = doc.page.height - 31;
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#555555")
      .text(
        `Page ${i - range.start + 1} of ${range.count}`,
        doc.page.margins.left,
        footerY,
        {
          width: pageUsableWidth(),
          align: "right",
          lineBreak: false,
        },
      );
  }

  doc.end();

  await new Promise((resolve, reject) => {
    stream.once("finish", resolve);
    stream.once("error", reject);
  });

  const stats = fs.statSync(filePath);
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error("Traceability PDF file was not created correctly");
  }

  return {
    success: true,
    path: filePath,
    fileName,
    orientation: pdfOrientation,
    sections: validSections.length,
    pages: range.count,
    size: stats.size,
  };
};

parentPort.on("message", async (payload) => {
  try {
    const result = await createTraceabilityPdf(payload || {});
    parentPort.postMessage(result);
  } catch (error) {
    parentPort.postMessage({
      success: false,
      message: error?.message || "Traceability PDF export failed",
    });
  }
});
