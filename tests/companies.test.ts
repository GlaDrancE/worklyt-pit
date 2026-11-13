import { describe, expect, it } from "vitest";
import {
  COMPANY_NAMES,
  POPULAR_COMPANIES,
  WORKLYFT,
  companyForPlayer,
  isCompanyName,
  rivalCompanyNames,
} from "../src/race/companies";

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

describe("company driver names", () => {
  it("provides 70 unique names including Worklyft", () => {
    expect(COMPANY_NAMES).toHaveLength(70);
    expect(new Set(COMPANY_NAMES).size).toBe(70);
    expect(COMPANY_NAMES).toContain(WORKLYFT);
    expect(isCompanyName(WORKLYFT)).toBe(true);
    expect(isCompanyName("Alex Racer")).toBe(false);
  });

  it("assigns small fields popular names and reserves Worklyft for a rival", () => {
    const names = rivalCompanyNames(10, seeded(17), 10, ["Google"]);
    expect(names).toHaveLength(10);
    expect(names[0]).toBe(WORKLYFT);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain("Google");
    expect(names.slice(1).every((name) => POPULAR_COMPANIES.includes(name as (typeof POPULAR_COMPANIES)[number]))).toBe(true);
  });

  it("uses the full pool for larger fields and never assigns Worklyft to a player", () => {
    const names = rivalCompanyNames(COMPANY_NAMES.length, seeded(23), 11);
    expect(new Set(names).size).toBe(COMPANY_NAMES.length);
    expect(names[0]).toBe(WORKLYFT);
    expect(names.slice(1).some((name) => !POPULAR_COMPANIES.includes(name as (typeof POPULAR_COMPANIES)[number]))).toBe(true);
    expect(isCompanyName(companyForPlayer("player-id", 20))).toBe(true);
    expect(companyForPlayer("player-id", 20)).not.toBe(WORKLYFT);
  });
});
