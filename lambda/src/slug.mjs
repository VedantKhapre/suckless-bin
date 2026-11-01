import { randomInt } from "node:crypto";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const LENGTH = 10;

/**
 * A new paste link: 10 random letters. That is 52^10 combinations (about 57 bits),
 * so links cannot be guessed. randomInt gives every letter an equal chance.
 */
export const newSlug = () =>
  Array.from({ length: LENGTH }, () => LETTERS[randomInt(LETTERS.length)]).join("");
