const sql = require("mssql");
const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");

const js = require("./meta.json");
function IST(dateInIST) {
  dateInIST.setHours(dateInIST.getHours() + 5);
  dateInIST.setMinutes(dateInIST.getMinutes() + 30);
  return dateInIST;
}
// main.js

// Modules to control application life and create native browser window
async function bigfunction(ele) {
  const data = [
    IST(new Date()).toISOString().split("T")[0],
    IST(new Date()).toISOString().split("T")[0],
  ];
  console.log(data);

  const transporter = nodemailer.createTransport({
    service: "gmail", // e.g., Gmail, Yahoo, Outlook
    auth: {
      user: js.user, // Your email address//tamilarasanc00@gmail.com
      pass: js.pass, // Your email password (or app-specific password if using 2FA)//ttgs ehdl avik eicj
    },
  });

  const config = {
    server: js.server,
    database: js.db,
    user: js.login_name,
    password: js.login_password,
    driver: "mssql",
    options: {
      trustedConnection: false,
      trustServerCertificate: true,
    },
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

  const backup_name = folderPath + "/shift1";

  async function mainvoid(params) {
    (async () => {
      try {
        await sql.connect(config);
        const result = await sql.query(
          `select * from ${js.table} where ${js.date_field} >= '${data[0]} ${js.shift_1[0]}' and ${js.date_field} <= '${data[0]} ${js.shift_1[1]}'`
        );
        // const result = await sql.query`SELECT TOP 1 * FROM ShiftDB ORDER BY DateTimeColumn DESC`;

        //  console.log(result);
        if (result?.recordset) {
          const ws = XLSX.utils.json_to_sheet(result.recordset);
          const wb = XLSX.utils.book_new();
          //  console.log(`test.xlsx`);

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
          const folder = path.join(__dirname, "./" + backup_name);
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
            console.log("success");

            process.exit();
          });
        }
        //  MailFunction(); //  if mail without zip file call MailFunction function
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

bigfunction();
