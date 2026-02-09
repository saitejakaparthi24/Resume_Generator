import bcrypt from "bcrypt";

const hash = await bcrypt.hash("amman123", 10);
console.log(hash);
