const sql = require("mssql");
// const XLSX = require("xlsx");
const XLSX = require("xlsx-js-style");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");

const js = require("./meta.json");
// main.js

// Modules to control application life and create native browser window
async function bigfunction(ele) {
  const data = ele && ele.split(",");
  // console.log(data);

  const transporter = nodemailer.createTransport({
    service: "gmail", // e.g., Gmail, Yahoo, Outlook
    auth: {
      user: js.user, // Your email address//tamilarasanc00@gmail.com
      pass: js.pass, // Your email password (or app-specific password if using 2FA)//ttgs ehdl avik eicj
    },
  });

  const config =
    js.login_name && js.login_password
      ? {
          server: js.server,
          database: js.db,
          user: js.login_name,
          password: js.login_password,
          options: {
            trustedConnection: false, // Set to true if using Windows Authentication
            trustServerCertificate: false, // Set to true if using self-signed certificates
          },
          driver: "mssql", // Required if using Windows Authentication
        }
      : {
          server: js.server,
          database: js.db,

          options: {
            trustedConnection: false, // Set to true if using Windows Authentication
            trustServerCertificate: false, // Set to true if using self-signed certificates
          },
          driver: "mssql", // Required if using Windows Authentication
        };
  // if(!fs.existsSync(folderPath)){
  // fs.mkdir(folderPath,()=>{
  //   console.log("folder created");

  // })
  // }
  //DESKTOP-14SN92V\SQLEXPRESS

  const folderPath = `./Backup/${new Date().toISOString().split("T")[0]}`;

  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true }, (err) => {
      console.log(err);
    });
  } else {
    // console.log("already exits");
  }

  const backup_name = folderPath + "/DOWNLOAD";

  async function mainvoid(params) {
    (async () => {
      try {
        await sql.connect(config);
        //  const result = await sql.query(`select * from ${js.table} where ${js.date_field} >= '${data[0]}' and ${js.date_field} <= '${data[1]}'`);
        // const result = await sql.query`SELECT TOP 1 * FROM ShiftDB ORDER BY DateTimeColumn DESC`;

        //  console.log(result);

        const c_shift = `(DATEPART(HOUR, ${js.date_field}) >= ${
          data?.[3]?.split("-")[0]
        } AND DATEPART(HOUR, ${js.date_field}) < 24) OR (DATEPART(HOUR, ${
          js.date_field
        }) >= 0 AND DATEPART(HOUR, ${js.date_field}) < ${
          data?.[3]?.split("-")[1]
        })`;
        const All_shift = ` DATEPART(HOUR, ${js.date_field}) >= ${
          data.shift?.split("-")[0]
        }   AND DATEPART(HOUR, ${js.date_field}) <  ${
          data?.shift?.split("-")[1]
        }   AND DATEPART(MINUTE, ${
          js.date_field
        }) >= 0   AND DATEPART(MINUTE, ${js.date_field}) <= 59;`;
        const result = await sql.query(
          `SELECT * FROM ${data[2]} WHERE ${js.date_field} >= '${
            data[0]
          }' AND ${js.date_field} <= '${data?.[1]}' AND ${
            parseInt(data?.[3]?.split("-")[0]) <
            parseInt(data?.[3]?.split("-")[1])
              ? All_shift
              : c_shift
          } `
        );

        if (result?.recordset) {
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
            const cell1 = XLSX.utils.encode_cell({ r: 1, c: index });

            if (!ws[cell1]) ws[cell1] = {}; // Ensure the cell exists

            ws[cell1].s = {
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
              const cell0 = XLSX.utils.encode_cell({ r: index + 1, c: hindex });

              if (!ws[cell0]) ws[cell0] = {}; // Ensure the cell exists

              ws[cell0].s = {
                font: { bold: true, color: { rgb: "000000" } }, // Light gray text
                fill: {
                  patternType: "solid", // Required for background color
                  fgColor: { rgb: headerColors[hindex] }, // Alternate colors
                },
              };
            });
          }
          XLSX.utils.book_append_sheet(wb, ws, `mssql`);

          const filepath = path.join(
            __dirname,
            "./" +
              backup_name +
              `/${data[0]}__${data[1]}_${new Date()
                .toTimeString()
                .slice(0, 9)
                .split(":")
                .join("_")}.xlsx`
          );
          XLSX.writeFile(wb, filepath);
        } else {
          //  console.log("else");
        }
      } catch (err) {
        console.error(err);
        process.exit();
      }
    })()
      .then(() => {
        // Zip the folder using async/await
        //  console.log(backup_name);
        function MailFunctionWithZip(params) {
          const zipFolder = require("zip-folder");
          const zipPath = "./example.zip";
          zipFolder(backup_name, zipPath, () => {
            //  console.log("Zip created successfully");

            const mailOptions = {
              from: "premkumarintech@gmail.com", // Sender address //tamilarasanc00@gmail.com
              to: "hiddenweb100@gmail.com", // Receiver(s) address
              subject: "Hello from Node.js!", // Subject line
              text: "This is a test email sent from Node.js using Nodemailer!", // Plain text body
              text: "Please find the attached document.",
              attachments: fs.existsSync(zipPath)
                ? [{ filename: "half.zip", path: zipPath }]
                : [],
            };

            // Step 3: Send the email
            transporter.sendMail(mailOptions, (error, info) => {
              if (error) {
                console.log("Error:", error);
                process.exit();
              }
              //  console.log("Email sent successfully:", info.response);
              process.exit();
            });
          });
        }
        //MailFunctionWithZip()  if mail with zip file call MailFunctionWithZip function
        function MailFunction(params) {
          const filepath = path.join(
            __dirname,
            "./" + backup_name + `/test.xlsx`
          );

          const mailOptions = {
            from: "premkumarintech@gmail.com", // Sender address //tamilarasanc00@gmail.com
            to: "hiddenweb100@gmail.com", // Receiver(s) address
            subject: "Hello from Node.js!", // Subject line
            text: "This is a test email sent from Node.js using Nodemailer!", // Plain text body
            text: "Please find the attached document.",
            attachments: fs.existsSync(filepath)
              ? [{ filename: "test.xlsx", path: filepath }]
              : [],
          };

          // Step 3: Send the email
          transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
              console.log("Error:", error);
              process.exit();
            }
            //  console.log("Email sent successfully:", info.response);
            console.log(folder);

            process.exit();
          });
        }
        //  MailFunction();  if mail without zip file call MailFunction function
        const folder = path.join(__dirname, "./" + backup_name);
        console.log(folder);
      })
      .finally(() => {
        process.exit();
      })
      .catch((err) => {
        process.exit();
      });
  }

  if (fs.existsSync(backup_name)) {
    mainvoid();
  } else {
    // console.log("folder not found");
    fs.mkdir(backup_name, { recursive: true }, (err) => {
      if (err) console.log(err);
      mainvoid();
    });
  }
}

bigfunction(process.argv[2]);
