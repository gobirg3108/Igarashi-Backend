const sql = require("mssql");
// const XLSX = require("xlsx");
const XLSX = require("xlsx-js-style");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");

// const js=require("./meta.json")
// main.js

// Modules to control application life and create native browser window
const jsonfs = require("fs").promises;
const metaread = fs.readFileSync(path.join(__dirname, "meta.json"), { encoding: "utf8" });
const js = JSON.parse(metaread);
console.log(js);

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
sql.connect(config);
