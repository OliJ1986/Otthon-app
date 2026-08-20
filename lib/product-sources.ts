type JsonRecord = Record<string, unknown>;

export type ExternalProduct = {
  source: "off" | "tesco" | "lidl";
  sourceProductId: string;
  barcode: string | null;
  productName: string;
  brand: string | null;
  quantity: string | null;
  packageSize: number | null;
  unit: string | null;
  categoryName: string;
  imageUrl: string | null;
  price: number | null;
  promotionPrice: number | null;
  promotionLabel: string | null;
  unitPrice: number | null;
  observedOn: string;
  validFrom: string | null;
  validUntil: string | null;
  sourceUrl: string | null;
};

type PackageAmount = {
  amount: number;
  unit: string;
  baseAmount: number;
  baseUnit: "g" | "ml" | "db";
};

type TescoConfig = { url: string; apiKey: string; expiresAt: number };

let cachedTescoConfig: TescoConfig | null = null;

const tescoSearchQuery = `query Search($query:String!,$page:Int=1,$count:Int){
  search(query:$query,page:$page,count:$count){
    info{total page count pageSize query{searchTerm actualTerm}}
    results{node{
      __typename
      ... on ProductInterface{
        id gtin title isForSale
        price{actual unitPrice unitOfMeasure}
        media{defaultImage{url}}
        promotions{id promotionType startDate endDate description price{beforeDiscount afterDiscount} attributes}
      }
    }}
  }
}`;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown): number | null {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOnly(value: unknown): string | null {
  const valueText = text(value);
  const match = valueText.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || null;
}

function dateFromEpoch(value: number | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value * 1000));
}

export function todayInBudapest() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function normalizeBarcode(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/^0+/, "") || "0";
}

export function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("hu-HU")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string) {
  const ignored = new Set(["a", "az", "es", "egy", "termek", "ize", "izu", "db", "g", "kg", "ml", "l"]);
  return new Set(fold(value).split(/\s+/).filter((token) => token.length > 1 && !ignored.has(token) && !/^\d+$/.test(token)));
}

export function parsePackage(value: string): PackageAmount | null {
  const normalized = fold(value).replace(/(\d)\s*,\s*(\d)/g, "$1.$2");
  const multi = [...normalized.matchAll(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|l|ml|db)\b/g)].at(-1);
  const simple = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|db)\b/g)].at(-1);
  const match = multi || simple;
  if (!match) return null;
  const multiplier = multi ? Number(match[1]) : 1;
  const amount = Number(multi ? match[2] : match[1]);
  const unit = String(multi ? match[3] : match[2]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (unit === "kg") return { amount: multiplier * amount, unit, baseAmount: multiplier * amount * 1000, baseUnit: "g" };
  if (unit === "l") return { amount: multiplier * amount, unit, baseAmount: multiplier * amount * 1000, baseUnit: "ml" };
  return { amount: multiplier * amount, unit, baseAmount: multiplier * amount, baseUnit: unit as "g" | "ml" | "db" };
}

function productScore(reference: ExternalProduct, candidate: ExternalProduct) {
  if (reference.barcode && candidate.barcode && normalizeBarcode(reference.barcode) === normalizeBarcode(candidate.barcode)) return 1_000;
  const referenceTokens = tokens(`${reference.brand || ""} ${reference.productName}`);
  const candidateTokens = tokens(`${candidate.brand || ""} ${candidate.productName}`);
  const common = [...referenceTokens].filter((token) => candidateTokens.has(token)).length;
  const union = new Set([...referenceTokens, ...candidateTokens]).size || 1;
  let score = (common / union) * 60;
  if (reference.brand && fold(candidate.productName).includes(fold(reference.brand))) score += 20;
  const referencePackage = parsePackage(reference.quantity || reference.productName);
  const candidatePackage = parsePackage(candidate.quantity || candidate.productName);
  if (referencePackage && candidatePackage) {
    if (referencePackage.baseUnit !== candidatePackage.baseUnit) score -= 30;
    else {
      const difference = Math.abs(referencePackage.baseAmount - candidatePackage.baseAmount) / referencePackage.baseAmount;
      score += difference <= 0.05 ? 35 : difference <= 0.2 ? 8 : -35;
    }
  }
  return score;
}

export function bestProductMatch(reference: ExternalProduct, candidates: ExternalProduct[]) {
  const ranked = candidates
    .map((candidate) => ({ candidate, score: productScore(reference, candidate) }))
    .sort((left, right) => right.score - left.score);
  return ranked[0] && ranked[0].score >= 25 ? ranked[0].candidate : null;
}

function queryForProduct(product: ExternalProduct) {
  const raw = `${product.brand || ""} ${product.productName}`
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|db)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return raw.slice(0, 80);
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 9_000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
}

export async function lookupOpenFoodFacts(barcode: string): Promise<ExternalProduct | null> {
  const fields = [
    "code", "product_name", "product_name_hu", "brands", "quantity", "categories",
    "image_front_url", "image_url",
  ].join(",");
  const response = await fetchWithTimeout(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`,
    { headers: { "user-agent": "Otthon/0.2 family-price-monitor" } },
  );
  if (!response.ok) return null;
  const payload = record(await response.json());
  if (payload.status !== 1) return null;
  const product = record(payload.product);
  const productName = text(product.product_name_hu) || text(product.product_name);
  if (!productName) return null;
  const quantity = text(product.quantity) || null;
  const packageAmount = parsePackage(quantity || productName);
  return {
    source: "off",
    sourceProductId: text(product.code) || barcode,
    barcode,
    productName,
    brand: text(product.brands).split(",")[0]?.trim() || null,
    quantity,
    packageSize: packageAmount?.amount ?? null,
    unit: packageAmount?.unit ?? null,
    categoryName: text(product.categories).split(",")[0]?.trim() || "Élelmiszer",
    imageUrl: text(product.image_front_url) || text(product.image_url) || null,
    price: null,
    promotionPrice: null,
    promotionLabel: null,
    unitPrice: null,
    observedOn: todayInBudapest(),
    validFrom: null,
    validUntil: null,
    sourceUrl: `https://world.openfoodfacts.org/product/${encodeURIComponent(barcode)}`,
  };
}

async function discoverTescoConfig(): Promise<TescoConfig> {
  if (cachedTescoConfig && cachedTescoConfig.expiresAt > Date.now()) return cachedTescoConfig;
  const environmentKey = process.env.TESCO_API_KEY?.trim();
  let url = "https://xapi.tesco.com/";
  let apiKey = environmentKey || "";
  try {
    const response = await fetchWithTimeout("https://bevasarlas.tesco.hu/shop/hu-HU/search?query=tej", {
      headers: { "user-agent": "Mozilla/5.0 Otthon-family-price-monitor" },
    });
    if (response.ok) {
      const html = (await response.text())
        .replaceAll("&quot;", "\"")
        .replace(/\\u([0-9a-f]{4})/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
      url = html.match(/"mangoUrl"\s*:\s*"([^"]+)"/)?.[1] || url;
      apiKey ||= html.match(/"mangoApiKey"\s*:\s*"([^"]+)"/)?.[1] || "";
    }
  } catch {
    // Az utolsó ismert publikus frontend-konfigurációval még megpróbáljuk a lekérést.
  }
  if (!apiKey) throw new Error("A Tesco publikus frontend-konfigurációja most nem olvasható.");
  cachedTescoConfig = { url, apiKey, expiresAt: Date.now() + 6 * 60 * 60_000 };
  return cachedTescoConfig;
}

function clubcardPrice(promotions: unknown, normalPrice: number) {
  const today = todayInBudapest();
  return array(promotions).reduce<{ price: number; label: string; from: string | null; until: string | null } | null>((best, raw) => {
    const promotion = record(raw);
    const description = text(promotion.description);
    const endDate = dateOnly(promotion.endDate);
    if (endDate && endDate < today) return best;
    const match = description.match(/([0-9][0-9 .]*)\s*Ft\b/i);
    const parsed = match ? number(match[1]) : null;
    if (parsed == null || parsed <= 0 || parsed >= normalPrice) return best;
    const candidate = {
      price: parsed,
      label: description || "Clubcard ár",
      from: dateOnly(promotion.startDate),
      until: endDate,
    };
    return !best || candidate.price < best.price ? candidate : best;
  }, null);
}

export async function searchTesco(query: string, count = 24): Promise<ExternalProduct[]> {
  const config = await discoverTescoConfig();
  const response = await fetchWithTimeout(config.url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "accept-language": "hu-HU",
      "content-type": "application/json",
      region: "HU",
      language: "hu-HU",
      "x-apikey": config.apiKey,
      origin: "https://bevasarlas.tesco.hu",
      referer: "https://bevasarlas.tesco.hu/",
    },
    body: JSON.stringify([{ operationName: "Search", variables: { query, page: 1, count }, query: tescoSearchQuery }]),
  });
  if (!response.ok) throw new Error(`Tesco keresés: ${response.status}`);
  const batch = array(await response.json());
  const search = record(record(record(batch[0]).data).search);
  return array(search.results).flatMap((raw): ExternalProduct[] => {
    const node = record(record(raw).node);
    const productName = text(node.title);
    const sourceProductId = text(node.id);
    const priceData = record(node.price);
    const normalPrice = number(priceData.actual);
    if (!productName || !sourceProductId || normalPrice == null || node.isForSale === false) return [];
    const packageAmount = parsePackage(productName);
    const media = record(record(node.media).defaultImage);
    const promotion = clubcardPrice(node.promotions, normalPrice);
    return [{
      source: "tesco",
      sourceProductId,
      barcode: text(node.gtin) || null,
      productName,
      brand: productName.split(/\s+/)[0] || null,
      quantity: packageAmount ? `${packageAmount.amount} ${packageAmount.unit}` : null,
      packageSize: packageAmount?.amount ?? null,
      unit: packageAmount?.unit ?? null,
      categoryName: "Tesco online",
      imageUrl: text(media.url) || null,
      price: normalPrice,
      promotionPrice: promotion?.price ?? null,
      promotionLabel: promotion?.label ?? null,
      unitPrice: number(priceData.unitPrice),
      observedOn: todayInBudapest(),
      validFrom: promotion?.from ?? null,
      validUntil: promotion?.until ?? null,
      sourceUrl: `https://bevasarlas.tesco.hu/shop/hu-HU/products/${encodeURIComponent(sourceProductId)}`,
    }];
  });
}

export async function searchLidl(query: string): Promise<ExternalProduct[]> {
  const url = new URL("https://www.lidl.hu/q/api/search");
  url.searchParams.set("assortment", "HU");
  url.searchParams.set("locale", "hu_HU");
  url.searchParams.set("version", "v2.0.0");
  url.searchParams.set("q", query);
  const response = await fetchWithTimeout(url.toString(), {
    headers: { accept: "*/*", "x-requested-with": "XMLHttpRequest", "user-agent": "Mozilla/5.0 Otthon-family-price-monitor" },
  });
  if (!response.ok) throw new Error(`Lidl keresés: ${response.status}`);
  const payload = record(await response.json());
  return array(payload.items).flatMap((raw): ExternalProduct[] => {
    const data = record(record(raw).gridbox);
    const product = record(data.data);
    const productName = text(product.fullTitle) || text(product.title);
    const sourceProductId = text(product.productId) || text(product.itemId) || text(product.erpNumber);
    const priceData = record(product.price);
    const currentPrice = number(priceData.price);
    if (!productName || !sourceProductId || currentPrice == null) return [];
    const packageText = text(record(priceData.basePrice).text).split(";")[0]?.trim() || "";
    const packageAmount = parsePackage(`${productName} ${packageText}`);
    const startSeconds = number(product.storeStartDate);
    const endSeconds = number(product.storeEndDate);
    const canonicalPath = text(product.canonicalPath) || text(product.canonicalUrl);
    const image = record(product.image);
    const discount = record(priceData.discount);
    return [{
      source: "lidl",
      sourceProductId,
      barcode: null,
      productName,
      brand: productName.split(/\s+/)[0] || null,
      quantity: packageAmount ? `${packageAmount.amount} ${packageAmount.unit}` : null,
      packageSize: packageAmount?.amount ?? null,
      unit: packageAmount?.unit ?? null,
      categoryName: "Lidl akció",
      imageUrl: text(product.image) || text(image.url) || text(image.src) || null,
      price: currentPrice,
      promotionPrice: null,
      promotionLabel: text(discount.discountText) || null,
      unitPrice: null,
      observedOn: todayInBudapest(),
      validFrom: dateFromEpoch(startSeconds),
      validUntil: dateFromEpoch(endSeconds),
      sourceUrl: canonicalPath ? new URL(canonicalPath, "https://www.lidl.hu").toString() : "https://www.lidl.hu/q/search",
    }];
  });
}

export async function searchRetailers(query: string) {
  const results = await Promise.allSettled([searchTesco(query), searchLidl(query)]);
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

export async function findRetailOffers(reference: ExternalProduct) {
  const query = queryForProduct(reference);
  if (query.length < 2) return [];
  const candidates = await searchRetailers(query);
  const matches = (["tesco", "lidl"] as const).flatMap((source) => {
    const match = bestProductMatch(reference, candidates.filter((candidate) => candidate.source === source));
    return match ? [match] : [];
  });
  return matches;
}
