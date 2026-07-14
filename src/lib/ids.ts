import { nanoid } from "nanoid";

export function newId() {
  return nanoid();
}

export function nowIso() {
  return new Date().toISOString();
}
