const fs = require("fs");
// const {getawaitSql} =require("../sqlConnection.js")
const XLSX = require("xlsx-js-style");
const path = require("path");

const { parentPort } = require("worker_threads");

parentPort.on("message", async ({ data, result }) => {
  let path_of_file = await createExcel(data, result);
  parentPort.postMessage(path_of_file);
});

const metaread = fs.readFileSync(path.join(__dirname, "meta.json"), { encoding: "utf8" });
const js = JSON.parse(metaread);
const folderPath = `../Backup/${new Date().toISOString().split("T")[0]}`;

if (!fs.existsSync(folderPath)) {
  fs.mkdirSync(folderPath, { recursive: true }, (err) => {
    console.log(err);
  });
} else {
  // console.log("already exits");
}

const createExcel = async (data, result) => {
  // const sql=await getawaitSql()
  console.log(data, "createexcel");

  const backup_name = folderPath + "/DOWNLOAD";
  const mainvoid = async () => {
    //     const c_shift=`(DATEPART(HOUR, ${js.date_field}) >= ${data.from_time?.split(":")?.[0]} AND DATEPART(HOUR, ${js.date_field}) < 24) OR (DATEPART(HOUR, ${js.date_field}) >= 0 AND DATEPART(HOUR, ${js.date_field}) < ${data.to_time?.split(":")?.[0]})`
    //  const All_shift=` DATEPART(HOUR, ${js.date_field}) >= ${data.from_time?.split(":")[0]}   AND DATEPART(HOUR, ${js.date_field}) <  ${data?.to_time?.split(":")[0]}   AND DATEPART(MINUTE, ${js.date_field}) >= 0   AND DATEPART(MINUTE, ${js.date_field}) <= 59;`
    // const result = await sql.query(`SELECT * FROM ${data.machine} WHERE ${js.date_field} >= '${data?.fromDate}' AND ${js.date_field} <= '${data?.toDate}' AND ${parseInt(data.from_time?.split(":")?.[0])<parseInt(data?.to_time?.split(":")?.[0])?All_shift:c_shift} `)  ;
    if (result?.length) {
      const headers = Object.keys(result?.[0]);
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
      const convert_string = (params) => {
        // console.log(new Date(params)?.toISOString()?.split(".")?.[0]);

        return new Date(params)
          ?.toISOString()
          ?.split(".")?.[0]
          ?.split("T")
          ?.join("  ");
      };
      const ws = XLSX.utils.aoa_to_sheet([
        header_data,
        headers,
        ...result?.reduce((prv, cur) => {
          prv.push(
            headers.map((item) =>
              item === "Date_Time"
                ? convert_string(cur[item]) || ""
                : cur[item] || ""
            )
          );
          // console.log(prv);
          return prv;
        }, []),
      ]);
      const wb = XLSX.utils.book_new();
      //  console.log(`test.xlsx`);

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
      for (let index = 1; index <= result.length; index++) {
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
        __dirname,
        ...(js.deploy ? js.xlsx_path : ["./"]),
        backup_name +
          `/${data?.fromDate}__${data?.toDate}_${new Date().toTimeString().slice(0, 9).split(":").join("_")}.xlsx`
      );
      console.log(filepath);

      XLSX.writeFile(wb, filepath);
      return path.join(
        __dirname,
        ...(js.deploy ? js.xlsx_path : ["./"]),
        backup_name
      );
    } else {
      //  console.log("else");
    }
  };
  if (!fs.existsSync(backup_name)) {
    // console.log("folder not found");
    fs.mkdirSync(backup_name, { recursive: true });

    return await mainvoid();
  } else {
    return await mainvoid();
  }
};
