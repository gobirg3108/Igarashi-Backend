const XLSX = require("xlsx-js-style");
const path = require("path");
const fs = require("fs");
const os = require("os");
const sql = require("./sqlConnection.js").getsql();
const mssql = require("mssql");
const bcrypt = require("bcryptjs");

// const nodemailer = require('nodemailer');
const { Worker } = require("worker_threads");
// const js=require("./meta.json")
// main.js
// const Piscina = require("piscina");
// Modules to control application life and create native browser window

const metaread = fs.readFileSync(path.join(__dirname, "meta.json"), {
  encoding: "utf8",
});
const js = JSON.parse(metaread);

const config =
  js.login_name && js.login_password
    ? {
        // SQL Server Authentication
        server: js.server,
        database: js.db,
        user: js.login_name,
        password: js.login_password,
        options: {
          trustedConnection: false, // Must be false for SQL auth
          trustServerCertificate: true, // Set to true to avoid certificate issues
          enableArithAbort: true,
        },
        driver: "mssql",
      }
    : {
        // Windows Authentication
        server: js.server,
        database: js.db,
        options: {
          trustedConnection: true, // Must be true for Windows auth
          trustServerCertificate: true, // Set to true
          enableArithAbort: true,
        },
        driver: "mssql",
      };

function getLocalDateFolderName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function resolveBackupOutputRoot(outputRoot) {
  if (typeof outputRoot === "string" && outputRoot.trim()) {
    return path.resolve(outputRoot);
  }

  return path.join(os.homedir(), "Documents", "Igarashi", "Backup");
}

function trimDecimal(value, dp) {
  if (value == null || value === "") return value;

  const str = value.toString();
  if (!str.includes(".")) return str;

  const [intPart, decPart] = str.split(".");
  const trimmed = decPart.slice(0, dp);

  return trimmed.length ? `${intPart}.${trimmed}` : intPart;
}

function getSafeColumnIdentifier(value, fieldName = "column") {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${fieldName}`);
  }

  return `[${value.replace(/]/g, "]]")}]`;
}

function validateTime(value, fieldName) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
    throw new Error(`Invalid ${fieldName}`);
  }

  return value;
}

/**
 * Build the complete date + shift filter.
 *
 * Normal shift (08:00 -> 17:00): each selected calendar date is filtered
 * inside that time window.
 *
 * Overnight shift (19:25 -> 12:23): selected dates are treated as SHIFT
 * START dates. Example for 2025-10-10:
 *   2025-10-10 19:25:00 -> 2025-10-11 12:23:59
 */
function buildShiftDateFilter(
  dateField,
  fromDateValue,
  toDateValue,
  fromTimeValue,
  toTimeValue,
) {
  const dateFieldSql = getSafeColumnIdentifier(dateField, "date field");
  const fromDate = validateIsoDate(fromDateValue, "fromDate");
  const toDate = validateIsoDate(toDateValue, "toDate");
  const fromTime = validateTime(fromTimeValue, "from time");
  const toTime = validateTime(toTimeValue, "to time");

  if (fromDate > toDate) {
    throw new Error("From Date cannot be after To Date");
  }

  const [fromHour, fromMinute] = fromTime.split(":").map(Number);
  const [toHour, toMinute] = toTime.split(":").map(Number);
  const fromTotal = fromHour * 60 + fromMinute;
  const toTotal = toHour * 60 + toMinute;

  const fromClock = `${fromTime}:00`;
  const toClock = `${toTime}:59.9999999`;

  if (fromTotal <= toTotal) {
    return {
      dateFieldSql,
      whereSql: `
        ${dateFieldSql} >= '${fromDate}T00:00:00.000'
        AND ${dateFieldSql} < DATEADD(
          DAY,
          1,
          CAST('${toDate}' AS date)
        )
        AND CAST(${dateFieldSql} AS TIME) >= '${fromClock}'
        AND CAST(${dateFieldSql} AS TIME) <= '${toClock}'
      `,
    };
  }

  return {
    dateFieldSql,
    whereSql: `
      (
        (
          ${dateFieldSql} >= '${fromDate}T00:00:00.000'
          AND ${dateFieldSql} < DATEADD(
            DAY,
            1,
            CAST('${toDate}' AS date)
          )
          AND CAST(${dateFieldSql} AS TIME) >= '${fromClock}'
        )
        OR
        (
          ${dateFieldSql} >= DATEADD(
            DAY,
            1,
            CAST('${fromDate}T00:00:00.000' AS datetime2)
          )
          AND ${dateFieldSql} < DATEADD(
            DAY,
            2,
            CAST('${toDate}' AS date)
          )
          AND CAST(${dateFieldSql} AS TIME) <= '${toClock}'
        )
      )
    `,
  };
}

function validateIsoDate(value, fieldName) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return value;
}

function getPagination(pageIndex, pageSize) {
  const index = Number(pageIndex);
  const size = Number(pageSize);

  if (
    !Number.isInteger(index) ||
    index < 0 ||
    !Number.isInteger(size) ||
    size <= 0 ||
    size > 10000
  ) {
    throw new Error("Invalid pagination");
  }

  return {
    offset: index * size,
    pageSize: size,
  };
}

const getSafeTableName = async (tableName) => {
  if (
    typeof tableName !== "string" ||
    !tableName.trim() ||
    tableName.length > 128
  ) {
    throw new Error("Invalid table name");
  }

  const normalizedTableName = tableName.trim();
  const request = await sql.request();

  request.input("tableName", mssql.VarChar(128), normalizedTableName);

  const result = await request.query(`
    SELECT
      s.name AS schema_name,
      t.name AS table_name
    FROM sys.tables t
    INNER JOIN sys.schemas s
      ON s.schema_id = t.schema_id
    WHERE t.name = @tableName
  `);

  const table = result?.recordset?.[0];

  if (!table) {
    throw new Error("Table not found");
  }

  const safeSchema = table.schema_name.replace(/]/g, "]]");

  const safeTable = table.table_name.replace(/]/g, "]]");

  return `[${safeSchema}].[${safeTable}]`;
};

const getdata = async (data) => {
  const safeTable = await getSafeTableName(data.machine);
  const { offset, pageSize } = getPagination(data.pageIndex, data.pageSize);
  const shiftFilter = buildShiftDateFilter(
    js.date_field,
    data.fromDate,
    data.toDate,
    data.from_time,
    data.to_time,
  );

  const query = `
    SELECT *
    FROM ${safeTable}
    WHERE ${shiftFilter.whereSql}
    ORDER BY ${shiftFilter.dateFieldSql} ASC
    OFFSET ${offset} ROWS
    FETCH NEXT ${pageSize} ROWS ONLY;
  `;

  const query_length = `
    SELECT COUNT(*) AS total
    FROM ${safeTable}
    WHERE ${shiftFilter.whereSql}
  `;

  const result = await sql.query(query);
  const result_length = await sql.query(query_length);

  let formattedData = result.recordset;

  try {
    const request = await sql.request();
    request.input("tableName", mssql.VarChar(200), data.machine);
    request.input(
      "templateName",
      mssql.VarChar(200),
      data.getSelTemplate || "",
    );

    const get_template = await request.query(`
      SELECT *
      FROM excel_template
      WHERE tablename = @tableName
        AND template_name = @templateName
        AND status = 1
        AND display = 1
    `);

    const templateMap = {};
    get_template.recordset.forEach((t) => {
      templateMap[t.field] = t;
    });

    formattedData = result.recordset.map((row) => {
      const newRow = { ...row };

      for (const field in templateMap) {
        const temp = templateMap[field];

        if (temp.DATA_TYPE === "float" || temp.DATA_TYPE === "decimal") {
          const dp = temp.decimalpoint ?? 3;
          newRow[field] = trimDecimal(newRow[field], dp);
        }
      }

      return newRow;
    });
  } catch (error) {
    console.log("error in fixing decimal trimming", error);
  }

  return {
    data: formattedData,
    data_length: result_length.recordset[0].total,
  };
};

const createExcel = async (data) => {
  // Legacy exporter retained for compatibility, but it must never write beside
  // app.asar / the application directory.
  const backup_name = path.join(
    resolveBackupOutputRoot(data?.outputRoot),
    getLocalDateFolderName(),
    "DOWNLOAD",
  );

  const mainvoid = async () => {
    const safeTable = await getSafeTableName(data.machine);
    const shiftFilter = buildShiftDateFilter(
      js.date_field,
      data.fromDate,
      data.toDate,
      data.from_time,
      data.to_time,
    );

    const result = await sql.query(`
      SELECT *
      FROM ${safeTable}
      WHERE ${shiftFilter.whereSql}
      ORDER BY ${shiftFilter.dateFieldSql} ASC
    `);
    if (result?.recordset?.length) {
      const headers = Object.keys(result.recordset[0]);

      const header_data = [
        "",
        "",
        "DECELERATION",
        "",
        "",
        "TERMINAL RESISTANCE",
        "",
        "",
        "NO LOAD VOLTAGE",
        "",
        "",
        "NO LOAD CURRENT",
        "",
        "",
        "NO LOAD SPEED",
        "",
        "",
        "LOAD VOLTAGE",
        "",
        "",
        "LOAD CURRENT",
        "",
        "",
        "LOAD SPEED",
      ];

      const ws = XLSX.utils.aoa_to_sheet([
        header_data,
        headers,
        ...result.recordset?.reduce((prv, cur) => {
          prv.push(headers.map((item) => cur[item] || ""));
          return prv;
        }, []),
      ]);
      const wb = XLSX.utils.book_new();

      const headerColor1 = ["#366092"];
      const headerColor2 = ["366092", "92CDDC"];
      const headerkeys = {
        Shift: "f2f2f2",
        Date_Time: "508ed9",
        Motor_No: "92cddd",
        Min: "ffff67",
        Max: "fbbe8f",
        "Actual CW": "f2f2f2",
        "Actual CCW": "f2f2f2",
        Actual: "f2f2f2",
        "RPM Variation": "f2f2f2",
        "Hall Sensor": "f2f2f2",
        "DOR Result": "f2f2f2",
        "TIR Result": "f2f2f2",
      };
      const headerColors = [
        "f2f2f2",
        "508ed9",
        "92cddd",
        "ffff67",
        "fbbe8f",
        "f2f2f2",
        "f2f2f2",
        "FFD700",
        "FFDAB9",
        "FF8C00",
        "CC5500",
        "FF0000",
        "DC143C",
        "FFFACD",
        "FFD700",
        "FFDAB9",
        "FF8C00",
        "CC5500",
        "FF0000",
        "DC143C",
      ];

      header_data.forEach((header, index) => {
        const cell0 = XLSX.utils.encode_cell({ r: 0, c: index });

        if (!ws[cell0]) ws[cell0] = {}; // Ensure the cell exists

        ws[cell0].s = {
          font: { bold: true, color: { rgb: "E9E9E9" } }, // Light gray text
          fill: {
            patternType: "solid", // Required for background color
            fgColor: { rgb: headerColor2[0] }, // Alternate colors
          },
        };
      });
      for (let index = 1; index <= result.recordset.length; index++) {
        // const element = result.recordset[index];

        headers.forEach((header, hindex) => {
          if (index === 1) {
            const cell1 = XLSX.utils.encode_cell({ r: index, c: hindex });

            if (!ws[cell1]) ws[cell1] = {}; // Ensure the cell exists

            ws[cell1].s = {
              font: { bold: true, color: { rgb: "E9E9E9" } }, // Light gray text
              fill: {
                patternType: "solid", // Required for background color
                fgColor: { rgb: headerColor2[0] }, // Alternate colors
              },
            };
          } else {
            const cell0 = XLSX.utils.encode_cell({ r: index, c: hindex });

            if (!ws[cell0]) ws[cell0] = {}; // Ensure the cell exists

            ws[cell0].s = {
              font: { bold: true, color: { rgb: "000000" } }, // Light gray text
              fill: {
                patternType: "solid", // Required for background color
                fgColor: { rgb: headerkeys[header] || "E9E9E9" }, // Alternate colors
              },
            };
          }
        });
      }
      XLSX.utils.book_append_sheet(wb, ws, `mssql`);

      const filepath = path.join(
        backup_name,
        `${data?.fromDate}__${data?.toDate}_${new Date()
          .toTimeString()
          .slice(0, 9)
          .split(":")
          .join("_")}.xlsx`,
      );

      XLSX.writeFile(wb, filepath);
      return backup_name;
    } else {
    }
  };
  if (!fs.existsSync(backup_name)) {
    fs.mkdirSync(backup_name, { recursive: true });

    return await mainvoid();
  } else {
    return await mainvoid();
  }
};
//  const worker = new Worker("./worker/excel_worker.js");
// const pool = new Piscina({
//   filename: path.resolve(__dirname, "worker","excel_worker.js"),
//   maxThreads: 4, // Adjust based on CPU cores
// });

const createExcel_concurrent = async (data) => {
  const safeTable = await getSafeTableName(data.machine);
  const shiftFilter = buildShiftDateFilter(
    js.date_field,
    data.fromDate,
    data.toDate,
    data.from_time,
    data.to_time,
  );

  const query = `
  SELECT *
  FROM ${safeTable}
  WHERE ${shiftFilter.whereSql}
  ORDER BY ${shiftFilter.dateFieldSql} ASC;
`;
  const result = await sql.query(query);

  let formattedData = result.recordset;

  try {
    const templateRequest = await sql.request();
    templateRequest.input("tableName", mssql.VarChar(255), data.machine);
    templateRequest.input(
      "templateName",
      mssql.VarChar(255),
      data.getSelTemplate || "",
    );

    const get_template = await templateRequest.query(`
      SELECT *
      FROM excel_template
      WHERE tablename = @tableName
        AND template_name = @templateName
        AND status = 1
        AND display = 1
    `);

    const templateMap = {};
    get_template.recordset.forEach((t) => {
      templateMap[t.field] = t;
    });

    // APPLY DECIMAL TRIM
    formattedData = result.recordset.map((row) => {
      const newRow = { ...row };

      for (const field in templateMap) {
        const temp = templateMap[field];

        if (temp.DATA_TYPE === "float" || temp.DATA_TYPE === "decimal") {
          const dp = temp.decimalpoint ?? 3;
          newRow[field] = trimDecimal(newRow[field], dp);
        }
      }

      return newRow;
    });
  } catch (error) {
    console.log("error in fixing decimal trimming", error);
  }

  try {
    const headerRequest = await sql.request();
    headerRequest.input("tableName", mssql.VarChar(255), data?.machine || "");
    headerRequest.input(
      "templateName",
      mssql.VarChar(255),
      data?.getSelTemplate || "",
    );

    const ress = await headerRequest.query(`
      SELECT *
      FROM excel_template
      WHERE tablename = @tableName
        AND template_name = @templateName
        AND status = 1
        AND display = 1
      ORDER BY order_no ASC
    `);

    let sqlData = ress?.recordset || [];

    // FORMAT INTO HEADERS ARRAY
    const headers = sqlData.map((item) => ({
      oldHeader: item.field,
      newHeader: item.header,
      header_bg: item.header_bg || "#ffffff",
      header_text: item.header_text || "#000000",
      content_bg: item.content_bg || "#ffffff",
      content_text: item.content_text || "#000000",
      order_no: item?.order_no ?? 9999,
      display: item.display ?? 0,
      DATA_TYPE: item.DATA_TYPE ?? "",
      type: item.type || "DATE",
    }));

    if (sqlData.length) {
      data.finalColumns = headers;
    }
  } catch (error) {
    console.log("error fetching in final header", error);
  }

  if (!formattedData?.length) {
    return "no data to export";
  }

  return await new Promise((resolve, reject) => {
    const worker = new Worker(
      path.join(__dirname, "worker", "excel_worker.js"),
    );
    let settled = false;

    worker.once("message", (message) => {
      settled = true;
      worker.terminate();
      resolve(message);
    });

    worker.once("error", (error) => {
      settled = true;
      worker.terminate();
      reject(error);
    });

    worker.once("exit", (code) => {
      if (!settled && code !== 0) {
        reject(new Error(`Excel worker stopped with exit code ${code}`));
      }
    });

    worker.postMessage({ result: formattedData, data });
  });
};

const createPDF_concurrent = async (data, js) => {
  const safeTable = await getSafeTableName(data.machine);
  const shiftFilter = buildShiftDateFilter(
    js.date_field,
    data.fromDate,
    data.toDate,
    data.from_time,
    data.to_time,
  );

  const query = `
  SELECT *
  FROM ${safeTable}
  WHERE ${shiftFilter.whereSql}
  ORDER BY ${shiftFilter.dateFieldSql} ASC;
`;

  const result = await sql.query(query);
  let formattedData = result.recordset;

  // --------------------------------------------------
  // TEMPLATE STYLING
  // --------------------------------------------------
  let styledHeaders = [];

  try {
    const templateRequest = await sql.request();
    templateRequest.input("tableName", mssql.VarChar(255), data.machine);
    templateRequest.input(
      "templateName",
      mssql.VarChar(255),
      data.getSelTemplate || "",
    );

    const ress = await templateRequest.query(`
      SELECT *
      FROM excel_template
      WHERE tablename = @tableName
        AND template_name = @templateName
        AND status = 1
      ORDER BY order_no ASC
    `);

    let sqlData = ress?.recordset || [];

    // --------------------------------------------------
    // STEP 1: Find actual Date_Time column name from DB result
    // --------------------------------------------------
    const dateTimeField =
      formattedData.length > 0
        ? Object.keys(formattedData[0]).find(
            (key) => key.toLowerCase() === "date_time",
          )
        : null;

    // --------------------------------------------------
    // STEP 2: Build styledHeaders — map Date/Time labels
    //         to Date_Time source with correct type
    // --------------------------------------------------
    styledHeaders = sqlData
      .filter((item) => item.display === 1)
      .map((item) => {
        const labelLower = item.header?.toLowerCase();
        const fieldLower = item.field?.toLowerCase();

        // Detect if this template column represents Date or Time
        const isDateCol = labelLower === "date" || fieldLower === "date";
        const isTimeCol = labelLower === "time" || fieldLower === "time";
        const isDateTimeField = fieldLower === "date_time";

        let type = "NORMAL";
        let sourceField = item.field;

        if (isDateTimeField) {
          // field IS Date_Time — will be split in worker via DATETIME type
          type = "DATETIME";
          sourceField = dateTimeField || item.field;
        } else if (isDateCol && dateTimeField) {
          // Template has a "Date" column — map to Date_Time source
          type = "DATE";
          sourceField = dateTimeField;
        } else if (isTimeCol && dateTimeField) {
          // Template has a "Time" column — map to Date_Time source
          type = "TIME";
          sourceField = dateTimeField;
        }

        return {
          original: sourceField,
          label: item.header,
          header_bg: item.header_bg || "#ffffff",
          header_text: item.header_text || "#000000",
          content_bg: item.content_bg || "#ffffff",
          content_text: item.content_text || "#000000",
          type,
        };
      });

    if (sqlData.length) {
      data.finalColumns = styledHeaders;
    }
  } catch (error) {
    console.log("PDF template error:", error);
  }

  // --------------------------------------------------
  // WORKER
  // --------------------------------------------------
  if (!formattedData?.length) {
    return "no data to export";
  }

  return await new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "worker", "pdf_worker.js"));
    let settled = false;

    worker.once("message", (msg) => {
      settled = true;
      worker.terminate();
      resolve(msg);
    });

    worker.once("error", (err) => {
      settled = true;
      worker.terminate();
      reject(err);
    });

    worker.once("exit", (code) => {
      if (!settled && code !== 0) {
        reject(new Error(`PDF worker stopped with exit code ${code}`));
      }
    });

    worker.postMessage({
      result: formattedData,
      data,
      styledHeaders: styledHeaders.length ? styledHeaders : null,
    });
  });
};

const gettable_name = async (params) => {
  const result = await sql.query(`SELECT TABLE_NAME 
FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_TYPE = 'BASE TABLE';
`);

  return result?.recordset?.length
    ? result?.recordset?.filter(
        (item) =>
          item?.TABLE_NAME?.startsWith("DXP") ||
          item?.TABLE_NAME?.startsWith("MD") ||
          item?.TABLE_NAME?.startsWith("MES"),
      )
    : [];
};

const gettable_structure = async (params) => {
  const request = await sql.request();

  request.input("tableName", mssql.VarChar(200), params?.TABLE_NAME);

  const result = await request.query(`
    SELECT
      COLUMN_NAME,
      DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = @tableName
    ORDER BY ORDINAL_POSITION
  `);

  return result?.recordset?.length ? result.recordset : [];
};

const add_template = async (data) => {
  const { tableName, template, templateName } = data;

  if (!tableName || !templateName || !Array.isArray(template)) {
    throw new Error("Invalid template data");
  }

  for (const row of template) {
    const request = await sql.request();

    request.input("tableName", mssql.VarChar(255), tableName);
    request.input("field", mssql.VarChar(255), row.oldHeader || "");
    request.input("header", mssql.VarChar(255), row.newHeader || "");
    request.input("headerBg", mssql.VarChar(50), row.header_bg || "");
    request.input("headerText", mssql.VarChar(50), row.header_text || "");
    request.input("contentBg", mssql.VarChar(50), row.content_bg || "");
    request.input("contentText", mssql.VarChar(50), row.content_text || "");
    request.input("display", mssql.Int, Number(row.display ?? 0));
    request.input("dataType", mssql.VarChar(50), row.DATA_TYPE || "");
    request.input(
      "decimalPoint",
      mssql.Int,
      Number.isFinite(Number(row.decimalpoint)) ? Number(row.decimalpoint) : 0,
    );
    request.input("templateName", mssql.VarChar(255), templateName);
    request.input(
      "orderNo",
      mssql.Int,
      Number.isFinite(Number(row.order_no)) ? Number(row.order_no) : 0,
    );
    request.input(
      "roundOf",
      mssql.Int,
      Number.isFinite(Number(row.roundof)) ? Number(row.roundof) : 0,
    );

    await request.query(`
      IF EXISTS (
        SELECT 1
        FROM excel_template
        WHERE tablename = @tableName
          AND field = @field
          AND template_name = @templateName
      )
      BEGIN
        UPDATE excel_template
        SET header = @header,
            header_bg = @headerBg,
            header_text = @headerText,
            content_bg = @contentBg,
            content_text = @contentText,
            order_no = @orderNo,
            display = @display,
            DATA_TYPE = @dataType,
            decimalpoint = @decimalPoint,
            roundof = @roundOf,
            updated_at = GETDATE(),
            status = 1
        WHERE tablename = @tableName
          AND field = @field
          AND template_name = @templateName;
      END
      ELSE
      BEGIN
        INSERT INTO excel_template (
          tablename,
          field,
          header,
          header_bg,
          header_text,
          content_bg,
          content_text,
          display,
          DATA_TYPE,
          decimalpoint,
          template_name,
          created_at,
          order_no,
          roundof,
          status
        )
        VALUES (
          @tableName,
          @field,
          @header,
          @headerBg,
          @headerText,
          @contentBg,
          @contentText,
          @display,
          @dataType,
          @decimalPoint,
          @templateName,
          GETDATE(),
          @orderNo,
          @roundOf,
          1
        );
      END
    `);
  }

  return { message: "Inserted/Updated successfully" };
};
const get_excel_template = async (data) => {
  const { tableName, template } = data;

  const request = await sql.request();
  request.input("tableName", mssql.VarChar(255), tableName || "");
  request.input("templateName", mssql.VarChar(255), template || "");

  const result = await request.query(`
    SELECT
      field AS oldHeader,
      header AS newHeader,
      header_bg,
      header_text,
      content_bg,
      content_text,
      order_no,
      display,
      decimalpoint,
      DATA_TYPE,
      roundof,
      template_name
    FROM excel_template
    WHERE tablename = @tableName
      AND template_name = @templateName
      AND display = 1
      AND status = 1
    ORDER BY order_no ASC
  `);

  return result.recordset;
};
const adduser = async (data) => {
  try {
    const { fullname, username, password, page } = data;

    if (!password) {
      return {
        success: false,
        message: "Password is required",
      };
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const request = await sql.request();

    request.input("fullname", mssql.VarChar(100), fullname?.trim());
    request.input("username", mssql.VarChar(100), username?.trim());
    request.input("password", mssql.VarChar(200), hashedPassword);
    request.input("page", mssql.VarChar(500), page);

    const result = await request.query(`
      INSERT INTO users
      (
        fullname,
        username,
        password,
        page,
        status,
        created_at
      )
      VALUES
      (
        @fullname,
        @username,
        @password,
        @page,
        1,
        GETDATE()
      )
    `);

    return {
      success: result?.rowsAffected?.[0] > 0,
      message:
        result?.rowsAffected?.[0] > 0 ? "User Added Successfully" : "Failed",
    };
  } catch (error) {
    console.error("Add User Error:", error);
    throw error;
  }
};

const getusers = async () => {
  const result = await sql.query(`
    SELECT
      id,
      fullname,
      username,
      page,
      status,
      created_at,
      updated_at
    FROM users
    WHERE status = 1
    ORDER BY id DESC
  `);

  return result;
};

const deleteuser = async (data) => {
  try {
    const id = Number(data?.id);

    if (!id) {
      return {
        message: "Invalid user",
        success: false,
      };
    }

    const request = await sql.request();

    request.input("id", mssql.Int, id);

    const result = await request.query(`
      UPDATE users
      SET
        status = 0,
        updated_at = GETDATE()
      WHERE id = @id
        AND status = 1
    `);

    if (result?.rowsAffected?.[0] === 0) {
      return {
        message: "No user found",
        success: false,
      };
    }

    return {
      message: "User deleted successfully",
      success: true,
    };
  } catch (error) {
    console.error("Delete User Error:", error);
    throw error;
  }
};

const updateuser = async (data) => {
  try {
    const { id, fullname, username, password, page } = data;

    const userId = Number(id);

    if (!userId) {
      return {
        success: false,
        message: "Invalid user",
      };
    }

    const request = await sql.request();

    request.input("id", mssql.Int, userId);
    request.input("fullname", mssql.VarChar(100), fullname?.trim());
    request.input("username", mssql.VarChar(100), username?.trim());
    request.input("page", mssql.VarChar(500), page);

    let query = `
      UPDATE users
      SET
        fullname = @fullname,
        username = @username,
        page = @page,
        updated_at = GETDATE()
    `;

    if (password?.trim()) {
      const hashedPassword = await bcrypt.hash(password, 12);

      request.input("password", mssql.VarChar(200), hashedPassword);

      query += `,
        password = @password
      `;
    }

    query += `
      WHERE id = @id
        AND status = 1
    `;

    const result = await request.query(query);

    return {
      success: result?.rowsAffected?.[0] > 0,
      message:
        result?.rowsAffected?.[0] > 0
          ? "User Updated Successfully"
          : "No user found",
    };
  } catch (error) {
    console.error("Update User Error:", error);
    throw error;
  }
};

const checkexistuser = async (data) => {
  try {
    const username = data?.username?.trim();
    const id = Number(data?.id || 0);

    if (!username) {
      return "New Data";
    }

    const request = await sql.request();

    request.input("username", mssql.VarChar(100), username);
    request.input("id", mssql.Int, id);

    const result = await request.query(`
      SELECT id
      FROM users
      WHERE username = @username
        AND status = 1
        AND (@id = 0 OR id <> @id)
    `);

    return result?.recordset?.length ? "Exists" : "New Data";
  } catch (error) {
    console.error("Check User Error:", error);
    throw error;
  }
};

const userlogin = async (data) => {
  try {
    const username = data?.username?.trim();
    const password = data?.password;

    if (!username || !password) {
      return {
        user: "",
        status: false,
      };
    }

    const request = await sql.request();

    request.input("username", mssql.VarChar(100), username);

    const result = await request.query(`
      SELECT id, username, password, page
      FROM users
      WHERE username = @username
        AND status = 1
    `);

    const user = result?.recordset?.[0];

    if (!user) {
      return {
        user: "",
        status: false,
      };
    }

    const storedPassword = user.password || "";

    let passwordMatched = false;

    const isHashed =
      storedPassword.startsWith("$2a$") ||
      storedPassword.startsWith("$2b$") ||
      storedPassword.startsWith("$2y$");

    if (isHashed) {
      passwordMatched = await bcrypt.compare(password, storedPassword);
    } else {
      // Old plaintext users — temporary backward compatibility
      passwordMatched = password === storedPassword;

      // If old password is correct, automatically upgrade it to bcrypt
      if (passwordMatched) {
        const hashedPassword = await bcrypt.hash(password, 12);

        const updateRequest = await sql.request();

        updateRequest.input("id", mssql.Int, user.id);

        updateRequest.input("password", mssql.VarChar(200), hashedPassword);

        await updateRequest.query(`
          UPDATE users
          SET
            password = @password,
            updated_at = GETDATE()
          WHERE id = @id
        `);
      }
    }

    if (!passwordMatched) {
      return {
        user: "",
        status: false,
      };
    }

    return {
      username: user.username,
      page: user.page,
      status: true,
    };
  } catch (error) {
    console.error("Login Error:", error);

    return {
      user: "",
      status: false,
    };
  }
};

const tablerename = async (data) => {
  try {
    const type = data?.getType;
    const oldName = data?.getOldName?.trim();
    const newName = data?.getNewName?.trim();

    if (!oldName || !["Insert", "Update", "Visiblity"].includes(type)) {
      return { message: "Invalid table data" };
    }

    const request = await sql.request();
    request.input("oldName", mssql.VarChar(200), oldName);

    if (type === "Insert") {
      request.input("newName", mssql.VarChar(200), newName || "");

      const result = await request.query(`
        INSERT INTO export_tables (
          machinename,
          exportname,
          created_at,
          updated_at,
          status
        )
        VALUES (
          @oldName,
          @newName,
          GETDATE(),
          GETDATE(),
          1
        )
      `);

      if (result?.rowsAffected?.[0] > 0) {
        return { message: "Table Name Successfully" };
      }
    }

    if (type === "Update") {
      request.input("newName", mssql.VarChar(200), newName || "");

      const result = await request.query(`
        UPDATE export_tables
        SET exportname = @newName,
            updated_at = GETDATE()
        WHERE machinename = @oldName
      `);

      if (result?.rowsAffected?.[0] > 0) {
        return { message: "Table Name Successfully" };
      }
    }

    if (type === "Visiblity") {
      const status = Number(data?.status) === 1 ? 1 : 0;
      request.input("status", mssql.Int, status);

      const result = await request.query(`
        UPDATE export_tables
        SET status = @status,
            updated_at = GETDATE()
        WHERE machinename = @oldName
      `);

      if (result?.rowsAffected?.[0] > 0) {
        return {
          status,
          message: "Table Name Successfully",
        };
      }
    }

    return { message: "No changes made" };
  } catch (error) {
    console.log("Error in Table Rename", error);
    throw error;
  }
};
const assemblytablerename = async (data) => {
  try {
    const type = data?.getType;
    const oldName = data?.getOldName?.trim();
    const newName = data?.getNewName?.trim();
    const menu = data?.menu?.trim();

    if (!oldName || !["Insert", "Update", "Visiblity"].includes(type)) {
      return { message: "Invalid table data" };
    }

    const request = await sql.request();
    request.input("oldName", mssql.VarChar(200), oldName);

    if (type === "Insert") {
      request.input("newName", mssql.VarChar(200), newName || "");
      request.input("menu", mssql.VarChar(200), menu || "");

      const result = await request.query(`
        INSERT INTO export_assemblytables (
          machinename,
          exportname,
          menu,
          created_at,
          updated_at,
          status
        )
        VALUES (
          @oldName,
          @newName,
          @menu,
          GETDATE(),
          GETDATE(),
          1
        )
      `);

      if (result?.rowsAffected?.[0] > 0) {
        return { message: "Table Name Successfully" };
      }
    }

    if (type === "Update") {
      request.input("newName", mssql.VarChar(200), newName || "");

      const result = await request.query(`
        UPDATE export_assemblytables
        SET exportname = @newName,
            updated_at = GETDATE()
        WHERE machinename = @oldName
      `);

      if (result?.rowsAffected?.[0] > 0) {
        return { message: "Table Name Successfully" };
      }
    }

    if (type === "Visiblity") {
      const status = Number(data?.status) === 1 ? 1 : 0;
      request.input("status", mssql.Int, status);

      const result = await request.query(`
        UPDATE export_assemblytables
        SET status = @status,
            updated_at = GETDATE()
        WHERE machinename = @oldName
      `);

      if (result?.rowsAffected?.[0] > 0) {
        return {
          status,
          message: "Table Name Successfully",
        };
      }
    }

    return { message: "No changes made" };
  } catch (error) {
    console.log("Error in Assembly Table Rename", error);
    throw error;
  }
};
const gettablename = async () => {
  const allTables = await gettable_name();

  if (!allTables.length) {
    return { mergedArray: [] };
  }

  const tableNames = allTables
    .map((t) => `'${String(t?.TABLE_NAME).replace(/'/g, "''")}'`)
    .join(",");

  const reNameTablesRes = await sql.query(
    `SELECT * FROM export_tables WHERE machinename IN (${tableNames})`,
  );
  const reNameTables = reNameTablesRes?.recordset;

  const mergedArray = allTables?.map((table) => {
    const match = reNameTables?.find((x) => x.machinename === table.TABLE_NAME);

    return {
      TABLE_NAME: table?.TABLE_NAME,
      exportname: match?.exportname ?? "",
      status: match?.status ?? 0,
    };
  });

  return { mergedArray };
};

const getAssemblyDatas = async (data) => {
  try {
    const allTables = await gettable_name();

    if (!allTables.length) {
      return { data: [], message: "Table Loaded" };
    }

    const tableNames = allTables
      .map((t) => `'${String(t?.TABLE_NAME).replace(/'/g, "''")}'`)
      .join(",");

    const request = await sql.request();
    request.input("menu", mssql.VarChar(200), data?.menu?.trim() || "");

    const reNameTablesRes = await request.query(`
      SELECT *
      FROM export_assemblytables
      WHERE menu = @menu
        AND machinename IN (${tableNames})
    `);

    const reNameTables = reNameTablesRes?.recordset || [];

    const mergedArray = allTables.map((table) => {
      const match = reNameTables.find(
        (x) => x.machinename === table.TABLE_NAME,
      );

      return {
        TABLE_NAME: table.TABLE_NAME,
        exportname: match?.exportname ?? "",
        menu: match?.menu ?? data?.menu,
        status: match?.status ?? 0,
      };
    });

    return {
      data: mergedArray,
      message: "Table Loaded",
    };
  } catch (error) {
    console.log("Error while fetching Assembly Table Data", error);
    throw error;
  }
};
const getAssemblytablename = async () => {
  const allTables = await gettable_name();

  if (!allTables.length) {
    return { mergedArray: [] };
  }

  const tableNames = allTables
    .map((t) => `'${String(t?.TABLE_NAME).replace(/'/g, "''")}'`)
    .join(",");

  const reNameTablesRes = await sql.query(
    `SELECT * FROM export_assemblytables WHERE machinename IN (${tableNames})`,
  );

  const reNameTables = reNameTablesRes?.recordset;

  const mergedArray = allTables?.map((table) => {
    const match = reNameTables?.find((x) => x.machinename === table.TABLE_NAME);

    return {
      TABLE_NAME: table?.TABLE_NAME,
      exportname: match?.exportname ?? "",
      menu: match?.menu ?? "",
      status: match?.status ?? 0,
    };
  });

  return { mergedArray };
};

const checkexisttable = async (data) => {
  try {
    const request = await sql.request();
    request.input("exportName", mssql.VarChar(200), data?.trim() || "");

    const res = await request.query(`
      SELECT id
      FROM export_tables
      WHERE exportname = @exportName
    `);

    return res?.recordset?.length ? "Exists" : "New Data";
  } catch (error) {
    console.log("Error Fetching in Check table", error);
    throw error;
  }
};
const checkexistassemblytable = async (data) => {
  try {
    const request = await sql.request();
    request.input("exportName", mssql.VarChar(200), data?.value?.trim() || "");
    request.input("menu", mssql.VarChar(200), data?.menu?.trim() || "");

    const res = await request.query(`
      SELECT id
      FROM export_assemblytables
      WHERE exportname = @exportName
        AND menu = @menu
    `);

    return res?.recordset?.length ? "Exists" : "New Data";
  } catch (error) {
    console.log("Error Fetching in Check assembly table", error);
    throw error;
  }
};
const getactivetable = async () => {
  try {
    const getActiveData = await sql.query(
      `SELECT * FROM export_tables where status = 1`,
    );

    return getActiveData?.recordset?.length
      ? getActiveData?.recordset?.map((item) => ({
          TABLE_NAME: item?.exportname,
          machinename: item?.machinename,
        }))
      : [];
  } catch (error) {
    console.log("Error in getting active tables");
  }
};

const getassemblytable = async (data) => {
  try {
    const getActiveData = await sql.query(
      `select * from export_assemblytables where menu = 'Encap Assembly' AND status = 1`,
    );

    return getActiveData?.recordset?.length
      ? getActiveData?.recordset?.map((item) => ({
          TABLE_NAME: item?.exportname,
          machinename: item?.machinename,
        }))
      : [];
  } catch (error) {
    console.log("Error in getting active tables");
  }
};

const checkexisttemplate = async (data) => {
  const { tableName, templateName } = data;

  try {
    const request = await sql.request();
    request.input("tableName", mssql.VarChar(255), tableName?.trim() || "");
    request.input(
      "templateName",
      mssql.VarChar(255),
      templateName?.trim() || "",
    );

    const res = await request.query(`
      SELECT id
      FROM excel_template
      WHERE tablename = @tableName
        AND template_name = @templateName
        AND status = 1
    `);

    return res?.recordset?.length ? "Exists" : "New Data";
  } catch (error) {
    console.log("Error Fetching in Check template", error);
    throw error;
  }
};
const editedTemplates = async (data) => {
  try {
    const request = await sql.request();
    request.input("tableName", mssql.VarChar(255), data?.trim() || "");

    const res = await request.query(`
      SELECT DISTINCT template_name
      FROM excel_template
      WHERE tablename = @tableName
        AND status = 1
      ORDER BY template_name
    `);

    return res.recordset;
  } catch (error) {
    console.log("Error Fetching in Edited Templates", error);
    throw error;
  }
};
const deletetemplate = async (data) => {
  const { machine, getSelTemplate } = data;

  try {
    const request = await sql.request();
    request.input("tableName", mssql.VarChar(255), machine || "");
    request.input("templateName", mssql.VarChar(255), getSelTemplate || "");

    return await request.query(`
      UPDATE excel_template
      SET status = 0,
          updated_at = GETDATE()
      WHERE tablename = @tableName
        AND template_name = @templateName
    `);
  } catch (error) {
    console.log("Error in Delete Template:", error);
    throw error;
  }
};
const tableHasColumn = async (tableName, columnName) => {
  const request = await sql.request();
  request.input(
    "tableName",
    mssql.NVarChar(128),
    String(tableName || "").trim(),
  );
  request.input(
    "columnName",
    mssql.NVarChar(128),
    String(columnName || "").trim(),
  );

  const result = await request.query(`
    SELECT TOP (1) 1 AS found
    FROM sys.tables t
    INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
    INNER JOIN sys.columns c ON c.object_id = t.object_id
    WHERE s.name = N'dbo'
      AND t.name = @tableName
      AND c.name = @columnName;
  `);

  return Boolean(result?.recordset?.[0]?.found);
};

const getdmcdata = async (data) => {
  const dmc = String(data?.getDmc ?? "").trim();

  if (!dmc) {
    return [];
  }

  try {
    const activeTablesQuery = await sql.query(`
      SELECT exportname AS TABLE_NAME, machinename
      FROM dbo.export_tables
      WHERE status = 1;
    `);
    const activeTablesRes = activeTablesQuery?.recordset || [];
    const resultDataz = [];

    for (const table of activeTablesRes) {
      const machineName = String(table?.machinename || "").trim();
      if (!machineName) continue;

      try {
        // Traceability is only valid for tables that physically contain DMC_Data.
        // A single active table without this column must not break every other
        // machine's traceability result.
        const hasDmcColumn = await tableHasColumn(machineName, "DMC_Data");
        if (!hasDmcColumn) {
          console.warn(
            `[WARN] Traceability skipped ${machineName}: DMC_Data column not found.`,
          );
          continue;
        }

        const safeTable = await getSafeTableName(machineName);
        const request = await sql.request();
        request.input("dmc", mssql.VarChar(500), dmc);

        const result = await request.query(`
          SELECT *
          FROM ${safeTable}
          WHERE LTRIM(RTRIM([DMC_Data])) = @dmc
        `);

        resultDataz.push({
          machinename: machineName,
          table: table?.TABLE_NAME || machineName,
          data: result?.recordset || [],
        });
      } catch (tableError) {
        console.warn(
          `[WARN] Traceability query skipped ${machineName}:`,
          tableError.message,
        );
      }
    }

    return resultDataz;
  } catch (error) {
    console.error("Error in fetching DMC data", error);
    throw error;
  }
};

//localhost:5173/settings

http: module.exports = {
  getdata,
  createExcel,
  createExcel_concurrent,
  createPDF_concurrent,
  gettable_name,
  gettable_structure,
  add_template,
  get_excel_template,
  adduser,
  getusers,
  deleteuser,
  updateuser,
  checkexistuser,
  userlogin,
  tablerename,
  gettablename,
  getAssemblytablename,
  checkexisttable,
  checkexistassemblytable,
  getactivetable,
  getassemblytable,
  checkexisttemplate,
  editedTemplates,
  deletetemplate,
  getdmcdata,
  assemblytablerename,
  getAssemblyDatas,
};
