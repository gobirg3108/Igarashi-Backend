function IST(dateInIST) {
  dateInIST.setHours(dateInIST.getHours() + 5);
  dateInIST.setMinutes(dateInIST.getMinutes() + 30);
  return dateInIST;
}
console.log(IST(new Date()).toISOString().split("T")[0]);

"".match();
