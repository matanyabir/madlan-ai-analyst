/**
 * Generates a scrypt hash for ADMIN_PASSWORD_HASH / USER_PASSWORD_HASH.
 *
 *   npm run hash-password -- "my password"
 */
import { hashPassword } from "../src/lib/auth/session";

const password = process.argv[2];
if (!password) {
  console.error('usage: npm run hash-password -- "<password>"');
  process.exit(1);
}
console.log(hashPassword(password));
