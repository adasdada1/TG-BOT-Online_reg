import { connection } from "./index.mjs";

async function getTimeTaken(date, service) {
  const timeTaken = [];
  const data = await connection.query(
    "SELECT * FROM Info WHERE date = ? AND service = ?",
    [date.join("-"), service]
  );

  for (let i = 0; i < data[0].length; i++) {
    const dataSplitted = data[0][i].time.split(":");
    timeTaken.push(dataSplitted.slice(0, dataSplitted.length - 1).join(":"));
  }
  return timeTaken;
}

async function postNewReg(date, time, serviceText, number, name) {
  await connection.query(
    "INSERT INTO Info(date,time,service,number,name) VALUES (?, ?, ?, ?, ?)",
    [date.join("-") + ":00", time, serviceText, number, name]
  );
}

export { getTimeTaken, postNewReg };
