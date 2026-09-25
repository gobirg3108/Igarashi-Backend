const sql = require("mssql");
const fs = require("fs");
const path = require("path");

const metaread = fs.readFileSync(path.join(__dirname, "meta.json"), "utf8");
const js = JSON.parse(metaread);

let pool = null;

const config = {
  server: js.server,
  database: js.db,
  driver: "mssql",
  user: js.login_name,
  password: js.login_password,
  options: {
    trustedConnection: false,
    trustServerCertificate: true,
    // SQL DATETIME values in this database are stored as local machine time.
    // Prevent node-mssql/tedious from interpreting them as UTC (+05:30 shift in UI).
    useUTC: false,
  },
};

async function connectDB() {
  try {
    if (!pool) {
      pool = await sql.connect(config);
      console.log(" SQL Connected Successfully");
    }
    return pool;
  } catch (err) {
    console.error(" SQL Connection Error:", err);
    pool = null;
    return null;
  }
}

function getsql() {
  return {
    query: async (q) => {
      const p = await connectDB();

      if (!p) {
        throw new Error(" No SQL connection");
      }

      return p.request().query(q);
    },

    request: async () => {
      const p = await connectDB();

      if (!p) {
        throw new Error(" No SQL connection");
      }

      return p.request();
    },
  };
}

async function find_table(table_name) {
  const request = await getsql().request();

  request.input("tableName", sql.VarChar(200), table_name);

  const result = await request.query(`
    SELECT COUNT(*) AS istable
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = @tableName
  `);

  return result.recordset[0].istable;
}

const gettable_name = async () => {
  const sqlObj = getsql();

  const result = await sqlObj.query(`
    SELECT TABLE_NAME 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_TYPE = 'BASE TABLE'
  `);

  console.log("resultzzzz...!", result);

  return result?.recordset?.length
    ? result.recordset.filter(
        (item) =>
          item?.TABLE_NAME?.startsWith("DXP") ||
          item?.TABLE_NAME?.startsWith("MD") ||
          item?.TABLE_NAME?.startsWith("MES"),
      )
    : [];
};

module.exports = { getsql, connectDB, find_table };
