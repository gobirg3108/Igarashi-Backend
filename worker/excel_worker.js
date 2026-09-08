const fs = require("fs");
const XLSX = require("xlsx-js-style");
const path = require("path");
const os = require("os");
const { parentPort } = require("worker_threads");

const getLocalDateFolderName = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// RECEIVE MESSAGE FROM MAIN PROCESS
parentPort.on("message", async ({ data, result }) => {
  let path_of_file = await createExcel(data, result);
  parentPort.postMessage(path_of_file);
});

// --------------------------------------------------------
//  MAIN EXCEL CREATOR
// --------------------------------------------------------
const createExcel = async (data, result) => {
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
  const backup_name = path.join(backupRoot, todayFolder, "DOWNLOAD");

  // Ensure Documents/Igarashi/Backup/YYYY-MM-DD/DOWNLOAD exists
  if (!fs.existsSync(backup_name)) {
    fs.mkdirSync(backup_name, { recursive: true });
  }

  const mainvoid = async () => {
    if (!result?.length) return;

    const template = data.finalColumns || [];

    // Remove Cycle_Time
    const dbHeaders = Object.keys(result[0]).filter(
      (h) => h.trim() !== "Cycle_Time",
    );

    let allowedHeaders = [];

    // --------------------------------------------
    //  Correct Condition
    // If NO-TEMPLATE → map dbHeaders
    // Else → map template.oldHeader
    // --------------------------------------------
    if (data?.getSelTemplate === "No-Template") {
      allowedHeaders = [...dbHeaders];
    } else {
      allowedHeaders = template.map((t) => t.oldHeader);
    }

    // Add Date_Time
    allowedHeaders.push("Date_Time");

    // Remove Date & Time
    allowedHeaders = allowedHeaders.filter((h) => h !== "Date" && h !== "Time");

    console.log("allowedHeaders", allowedHeaders);

    let headers = [];

    // ----------------------------------------------------
    // BUILD HEADERS WITH DATE/TIME SPLIT + COLOR SUPPORT
    // ----------------------------------------------------
    allowedHeaders.forEach((col) => {
      const normalMatch = template.find(
        (t) => t.oldHeader?.toLowerCase() === col.toLowerCase(),
      );

      // --- SPECIAL CASE: SPLIT Date_Time INTO Date + Time ---
      if (col === "Date_Time") {
        const dateMatch = template.find((t) =>
          t.oldHeader?.toLowerCase().includes("date"),
        );

        const timeMatch = template.find((t) =>
          t.oldHeader?.toLowerCase().includes("time"),
        );

        // DATE COLUMN
        headers.push({
          original: "Date_Time",
          oldHeader: dateMatch?.oldHeader || "Date",
          newHeader: dateMatch?.newHeader || "Date",
          header_bg: dateMatch?.header_bg || "#ffffff",
          header_text: dateMatch?.header_text || "#000000",
          content_bg: dateMatch?.content_bg || "#ffffff",
          content_text: dateMatch?.content_text || "#000000",
          order_no: dateMatch?.order_no ?? 9999,
          type: "DATE",
        });

        // TIME COLUMN
        headers.push({
          original: "Date_Time",
          oldHeader: timeMatch?.oldHeader || "Time",
          newHeader: timeMatch?.newHeader || "Time",
          header_bg: timeMatch?.header_bg || "#ffffff",
          header_text: timeMatch?.header_text || "#000000",
          content_bg: timeMatch?.content_bg || "#ffffff",
          content_text: timeMatch?.content_text || "#000000",
          order_no: timeMatch?.order_no ?? 9999,
          type: "TIME",
        });

        return;
      }

      // NORMAL COLUMNS
      headers.push({
        original: col,
        oldHeader: col,
        newHeader: normalMatch?.newHeader || col,
        header_bg: normalMatch?.header_bg || "#ffffff",
        header_text: normalMatch?.header_text || "#000000",
        content_bg: normalMatch?.content_bg || "#ffffff",
        content_text: normalMatch?.content_text || "#000000",
        order_no: normalMatch?.order_no ?? 9999,
        type: "NORMAL",
      });
    });

    // ----------------------------------------------------
    // SORT HEADERS BY ORDER NUMBER
    // ----------------------------------------------------
    headers.sort((a, b) => a.order_no - b.order_no);

    // ----------------------------------------------------
    //  FIXED: FORMAT EACH ROW WITHOUT TIMEZONE CONVERSION
    // ----------------------------------------------------
    const formatRow = (row) =>
      headers.map((h) => {
        const value = row[h.original];

        if (h.original === "Date_Time") {
          //  FIX: Normalize both Date objects and strings to avoid IST (+5:30) offset.
          // The mssql driver converts SQL datetime columns into JS Date objects.
          // Calling .getHours() on them applies the local timezone (IST = UTC+5:30),
          // shifting 09:00 → 14:30. Using .toISOString() always returns UTC, preserving
          // the original database time.
          const rawString =
            value instanceof Date
              ? value.toISOString() // always UTC → "2025-11-13T09:00:01.000Z"
              : typeof value === "string"
                ? value
                : null;

          if (rawString) {
            const normalized = rawString
              .replace(/Z$/, "") // remove trailing Z
              .replace(/[+-]\d{2}:\d{2}$/, "") // remove +05:30 style offset
              .replace("T", " ");

            const [datePart, timePart = ""] = normalized.split(" ");

            if (h.type === "DATE") return datePart; // "2025-11-13"
            if (h.type === "TIME") return timePart.split(".")[0]; // "09:00:01"
          }
        }

        return value ?? "";
      });

    // ----------------------------------------------------
    // BUILD EXCEL SHEET
    // ----------------------------------------------------
    const ws = XLSX.utils.aoa_to_sheet([
      headers.map((h) => h.newHeader),
      ...result.map((row) => formatRow(row)),
    ]);

    const wb = XLSX.utils.book_new();

    // ----------------------------------------------------
    // APPLY COLORS TO EVERY CELL
    // ----------------------------------------------------
    for (let r = 0; r <= result.length; r++) {
      headers.forEach((h, c) => {
        const cell = XLSX.utils.encode_cell({ r, c });

        if (!ws[cell]) ws[cell] = {};

        const isHeader = r === 0;

        ws[cell].s = isHeader
          ? {
              font: {
                bold: true,
                color: { rgb: h.header_text.replace("#", "") },
              },
              fill: {
                patternType: "solid",
                fgColor: { rgb: h.header_bg.replace("#", "") },
              },
            }
          : {
              font: {
                bold: false,
                color: { rgb: h.content_text.replace("#", "") },
              },
              fill: {
                patternType: "solid",
                fgColor: { rgb: h.content_bg.replace("#", "") },
              },
            };
      });
    }

    XLSX.utils.book_append_sheet(wb, ws, "DATA");

    // ----------------------------------------------------
    // SAVE TO FILE
    // ----------------------------------------------------
    const fileName = `${data.machine.slice(0, 25)}_${new Date()
      .toTimeString()
      .slice(0, 9)
      .replace(/:/g, "_")}.xlsx`;

    const filepath = path.join(backup_name, fileName);

    XLSX.writeFile(wb, filepath);

    return backup_name;
  };

  return await mainvoid();
};
