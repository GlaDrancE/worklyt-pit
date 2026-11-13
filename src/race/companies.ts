import type { Livery } from "../vehicle/CarView";

export const WORKLYFT = "Worklyft";

export const POPULAR_COMPANIES = [
  "Google",
  "Amazon",
  "Microsoft",
  "IBM",
  "Infosys",
  "Apple",
  "Samsung",
  "Meta",
  "Oracle",
  "Nvidia",
] as const;

const OTHER_COMPANIES = [
  "Adobe",
  "Accenture",
  "Airbnb",
  "Alibaba",
  "AMD",
  "American Express",
  "AT&T",
  "BMW",
  "Boeing",
  "Bosch",
  "Canon",
  "Capgemini",
  "Cisco",
  "Coca-Cola",
  "Dell",
  "Disney",
  "Dropbox",
  "eBay",
  "Ericsson",
  "FedEx",
  "Ford",
  "Goldman Sachs",
  "Honda",
  "Hyundai",
  "Intel",
  "JPMorgan",
  "Lenovo",
  "LinkedIn",
  "Mastercard",
  "McDonald's",
  "Mercedes-Benz",
  "Micron",
  "Netflix",
  "Nike",
  "Nokia",
  "PayPal",
  "PepsiCo",
  "Pfizer",
  "Qualcomm",
  "Renault",
  "SAP",
  "Siemens",
  "Sony",
  "Spotify",
  "Starbucks",
  "Subaru",
  "Tata",
  "Tesla",
  "Toyota",
  "Uber",
  "Unilever",
  "Verizon",
  "Visa",
  "Volkswagen",
  "Walmart",
  "Workday",
  "Xiaomi",
  "Zoom",
  "Entugo",
] as const;

export const COMPANY_NAMES = [...POPULAR_COMPANIES, ...OTHER_COMPANIES, WORKLYFT] as const;

export const WORKLYFT_LIVERY: Livery = {
  body: 0x071329,
  bodyGradient: [0x030711, 0x0b3473, 0x17a9ff],
  accent: 0x51caff,
  helmet: 0x071329,
  compound: 0xffd21f,
  pod: 0x18aaff,
};

function playerPool(fieldSize: number): readonly string[] {
  return fieldSize <= 10 ? POPULAR_COMPANIES : COMPANY_NAMES.filter((name) => name !== WORKLYFT);
}

export function isCompanyName(name: string): boolean {
  return COMPANY_NAMES.includes(name as (typeof COMPANY_NAMES)[number]);
}

export function companyForPlayer(id: string, fieldSize = 4): string {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619) >>> 0;
  const pool = playerPool(fieldSize).filter((name) => name !== WORKLYFT);
  return pool[hash % pool.length]!;
}

export function rivalCompanyNames(
  count: number,
  rand: () => number,
  fieldSize: number,
  reserved: readonly string[] = [],
): string[] {
  if (count <= 0) return [];
  const pool = (fieldSize <= 10 ? POPULAR_COMPANIES : COMPANY_NAMES.filter((name) => name !== WORKLYFT))
    .filter((name) => !reserved.includes(name));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return [WORKLYFT, ...pool].slice(0, count);
}
