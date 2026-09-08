const XLSX = require("xlsx");
const path = require("path");
const mongodb = require("mongodb");
const client = new mongodb.MongoClient("mongodb://0.0.0.0:27017/");
const db = client.db("godrej_interio");
const fs = require("fs");
const nodemailer = require("nodemailer");

// Step 1: Create a transporter object
const transporter = nodemailer.createTransport({
  service: "gmail", // e.g., Gmail, Yahoo, Outlook
  auth: {
    user: "premkumarintech@gmail.com", // Your email address
    pass: "jwqkbwmcqsugljuw", // Your email password (or app-specific password if using 2FA)
  },
});
const collections = [
  "PIVATIC",

  "PAINTSHOP",

  "LVD_2",
  "PB_14",
  //   'alarms',
  "PB_15",
  //   'alarms_alerts',
  "FM_01",
  //   'godrej_maitenance_records',
  //   'alarm_datas',
  "PB_16",
  "LVD_1",
  "FLEXI_1",
  "FLEXI_2",
  //   'argue',
  // 'productions'
];
// async function getcol(params) {
//    console.log( (await db.collections()).map((item)=>item.collectionName));

// }
// getcol()
const arr = [];
if (
  !fs.existsSync(
    `./Godrej_Daily_Backup/${new Date().toISOString().split("T")[0]}`
  )
) {
  fs.mkdirSync(
    `./Godrej_Daily_Backup/${new Date().toISOString().split("T")[0]}`,
    { recursive: true },
    (err) => {
      console.log(err);
    }
  );
} else {
  console.log("already exits");
}

const date = new Date();
let lostdate;
// =new Date(date.toISOString().split("T")[0])
// console.log(date.getHours());
let fromdate;
let sheet_size = date.getHours() >= 12;
let currentpath;
if (sheet_size) {
  fromdate = new Date(date.toISOString().split("T")[0]);
  date.setDate(date.getDate() + (sheet_size ? 1 : -1));
  lostdate = new Date(date.toISOString().split("T")[0]);
  currentpath = `./Godrej_Daily_Backup/${
    fromdate.toISOString().split("T")[0]
  }/Half`;
  fs.mkdirSync(currentpath, { recursive: true }, (err) => {
    console.log(err);
  });
} else {
  lostdate = new Date(date.toISOString().split("T")[0]);
  date.setDate(date.getDate() + (sheet_size ? 1 : -1));
  fromdate = new Date(date.toISOString().split("T")[0]);
  currentpath = `./Godrej_Daily_Backup/${
    fromdate.toISOString().split("T")[0]
  }/Full`;
  fs.mkdirSync(currentpath, { recursive: true }, (err) => {
    console.log(err);
  });
}
// collections.forEach(async(item)=>{
async function makexlsx(params) {
  for (let item of collections) {
    // const item = collections[index];

    const XLSX = require("xlsx");

    const result = await db
      .collection(item)
      .find(
        {
          $and: [
            { Created_At: { $gte: fromdate } },
            { Created_At: { $lte: lostdate } },
          ],
        },
        { projection: { _id: 0 } }
      )
      .toArray();
    //  console.log(result);
    if (result[0]) {
      const ws = XLSX.utils.json_to_sheet(result);
      const wb = XLSX.utils.book_new();
      console.log(
        `${item}_${fromdate.toISOString().split("T")[0]}-${
          lostdate.toISOString().split("T")[0]
        }.xlsx`
      );

      XLSX.utils.book_append_sheet(
        wb,
        ws,
        `${fromdate.toISOString().split("T")[0]}_${
          lostdate.toISOString().split("T")[0]
        }`
      );
      const filepath = path.join(
        __dirname,
        currentpath +
          `/${item}_${fromdate.toISOString().split("T")[0]}_${
            lostdate.toISOString().split("T")[0]
          }.xlsx`
      );
      XLSX.writeFile(wb, filepath);
    }
  }
}

makexlsx().then(() => {
  const zipFolder = require("zip-folder");
  const folderPath = currentpath;
  const zipPath = "./example.zip";

  // Zip the folder using async/await
  zipFolder(folderPath, zipPath, () => {
    console.log("Zip created successfully");
    const mailOptions = {
      from: "premkumarintech@gmail.com", // Sender address
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
        return process.exit();
      }
      console.log("Email sent successfully:", info.response);
      process.exit();
    });
  });
});
// })

// attachments: [
//   { filename: 'test.xlsx', path: './test.xlsx' }
// ]
// Step 2: Set up email options
// const date=new Date()
// let chooseFolder=date.getHours()>=12

// const files=fs.readdirSync(currentpath).map((item)=>({filename:item,path:currentpath+"/"+item}))

// const date=new Date().toISOString().split("T")[0]
// const date=new Date()
// let lostdate;
// // =new Date(date.toISOString().split("T")[0])
// // console.log(date.getHours());
// let fromdate;

// if(date.getHours()>=12){
//   fromdate= new Date(date.toISOString().split("T")[0])
//   date.setDate(date.getDate()+(date.getHours()>12?(1):(-1)))
//   lostdate=  new Date(date.toISOString().split("T")[0])
// }else{
//   lostdate = new Date(date.toISOString().split("T")[0])
//   date.setDate(date.getDate()+(date.getHours()>12?(1):(-1)))
//   fromdate=  new Date(date.toISOString().split("T")[0])

// }

// console.log(fromdate,lostdate);
//
