#!/usr/bin/env node
// Prints a bcrypt hash for ADMIN_PASSWORD_HASH. Usage: pnpm admin:hash "<password>"
// Never store the plaintext; paste the hash into the host's environment config.
import bcrypt from "bcryptjs";

const pw = process.argv[2];
if (!pw || pw.length < 12) {
  console.error("usage: pnpm admin:hash <password of at least 12 characters>");
  process.exit(1);
}
console.log(await bcrypt.hash(pw, 12));
