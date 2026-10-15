import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");

export const sql = neon(url);

export const num = (v: unknown) => (v == null ? 0 : Number(v));
