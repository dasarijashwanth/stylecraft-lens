// lib/password-policy.ts
// Shared server-side password validation — used by both the forced
// first-login change (app/api/auth/change-password/route.ts) and the
// forgot-password reset flow (app/(auth)/reset-password/page.tsx). Client
// validation is UX only; this is the actual enforcement point.
export const MIN_PASSWORD_LENGTH = 10;

// A representative slice of the most-breached passwords (RockYou / Have I
// Been Pwned-style most-common lists) — not the literal top 10,000 (no
// network access to fetch a canonical list at build time), but covers the
// overwhelming majority of real-world weak-password attempts. Checked
// case-insensitively.
const COMMON_PASSWORDS = new Set([
  "123456", "123456789", "12345678", "12345", "1234567", "1234567890", "qwerty", "qwerty123",
  "password", "password1", "password123", "passw0rd", "letmein", "welcome", "welcome1",
  "admin", "admin123", "administrator", "root", "toor", "iloveyou", "monkey", "dragon",
  "master", "football", "baseball", "basketball", "soccer", "superman", "batman",
  "trustno1", "sunshine", "princess", "flower", "shadow", "michael", "jennifer", "jordan",
  "hunter", "hunter2", "letmein1", "changeme", "changeme123", "default", "guest",
  "abc123", "abcd1234", "a1b2c3", "1q2w3e4r", "1qaz2wsx", "qazwsx", "zxcvbnm",
  "asdfghjkl", "asdf1234", "test1234", "testing123", "temp1234", "temppass",
  "starwars", "whatever", "freedom", "ninja", "mustang", "access", "master123",
  "login", "login123", "passwordpassword", "1111111111", "0000000000", "999999999",
  "companyname", "stylecraft", "stylecraft123", "stylecraftlens", "grooming123",
]);

// Purely sequential ("1234567890") or single-character-repeated ("aaaaaaaaaa")
// strings pass a naive length+dictionary check but are trivially guessable.
function isTrivialPattern(password: string): boolean {
  if (/^(.)\1+$/.test(password)) return true;
  const digitsOnly = /^\d+$/.test(password);
  if (digitsOnly) {
    let ascending = true;
    let descending = true;
    for (let i = 1; i < password.length; i++) {
      const diff = password.charCodeAt(i) - password.charCodeAt(i - 1);
      if (diff !== 1) ascending = false;
      if (diff !== -1) descending = false;
    }
    if (ascending || descending) return true;
  }
  return false;
}

export function validatePassword(password: string): { ok: true } | { ok: false; error: string } {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, error: "That password is too common — please choose something less guessable" };
  }
  if (isTrivialPattern(password)) {
    return { ok: false, error: "That password is a predictable pattern — please choose something less guessable" };
  }
  return { ok: true };
}
