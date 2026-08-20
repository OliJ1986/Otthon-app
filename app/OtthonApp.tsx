"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IonApp, IonIcon, setupIonicReact } from "@ionic/react";
import {
  add,
  bagHandleOutline,
  barcodeOutline,
  calendarClearOutline,
  carOutline,
  cartOutline,
  checkmark,
  checkmarkCircle,
  checkmarkDoneCircleOutline,
  chevronBack,
  chevronForward,
  close,
  cloudDoneOutline,
  createOutline,
  homeOutline,
  locationOutline,
  medicalOutline,
  notificationsOutline,
  pricetagOutline,
  repeatOutline,
  searchOutline,
  schoolOutline,
  sparklesOutline,
  trashOutline,
} from "ionicons/icons";

setupIonicReact({ mode: "ios" });

type Tab = "today" | "calendar" | "chores" | "shopping";
type AddMode = "event" | "chore" | "shopping";
type Tone = "violet" | "blue" | "coral" | "mint" | "orange" | "green" | "pink" | "yellow";
type EventKind = "medical" | "school" | "other";
type RepeatRule = "none" | "daily" | "weekly" | "monthly";

type FamilyEvent = {
  id: number;
  date: string;
  startTime: string;
  departureTime: string | null;
  title: string;
  person: string;
  driver: string;
  place: string;
  tone: Tone;
  kind: EventKind;
  repeatRule: RepeatRule;
  reminderMinutes: number;
  reminderEnabled: boolean;
};

type Chore = {
  id: number;
  title: string;
  room: string;
  assignee: string;
  dueLabel: string;
  recurring: boolean;
  repeatRule: RepeatRule;
  done: boolean;
  tone: Tone;
};

type ShoppingItem = {
  id: number;
  name: string;
  quantity: string;
  category: string;
  checked: boolean;
  priceWatch?: PriceWatchSummary | null;
};

type PriceWatchSummary = { id: number; productId: string; productName: string | null; targetPrice: string | null; bestPrice: string | null; bestChain: string | null; dataDate: string | null; source?: string | null };
type PriceOffer = { source: "gvh" | "tesco" | "lidl" | "manual"; chainName: string; maxPrice: string; maxUnitPrice: string | null; storeCount: number; promotionPrice: string | null; promotionLabel: string | null; validUntil: string | null; observedOn: string; locationLabel: string | null };
type PriceWatchDetail = { id: number; shoppingItemId: number; productId: string; productName: string; categoryName: string; unit: string; packageSize: string; targetPrice: string | null; notifyOnDrop: boolean; dataDate: string | null; offers: PriceOffer[]; history: Array<{ date: string; maxPrice: string }> };
type PriceSearchOffer = { source: "gvh" | "tesco" | "lidl" | "manual"; chainName: string; price: string; promotionPrice: string | null; promotionLabel: string | null; observedOn: string; validUntil: string | null };
type PriceSearchResult = { productId: string; productName: string; categoryName: string; unit: string; packageSize: string; bestPrice: string | null; bestChain: string | null; chainCount: number; dataDate: string | null; sources: string[]; offers: PriceSearchOffer[]; cached?: boolean; imageUrl?: string | null };

type Actor = { id: number; username: string; displayName: string; role: "owner" | "member" };
type AuthMode = "checking" | "setup" | "login" | "authenticated";

type FamilyMember = {
  id: number;
  name: string;
  tone: Tone;
  memberType: "adult" | "child";
  sortOrder: number;
};

type HouseholdResponse = {
  actor: Actor;
  events: FamilyEvent[];
  chores: Chore[];
  shopping: ShoppingItem[];
  familyMembers: FamilyMember[];
  syncedAt: string;
};

type Draft = {
  title: string;
  date: string;
  startTime: string;
  departureTime: string;
  person: string;
  driver: string;
  place: string;
  kind: EventKind;
  reminderMinutes: number;
  reminderEnabled: boolean;
  room: string;
  assignee: string;
  dueLabel: string;
  repeatRule: RepeatRule;
  quantity: string;
  category: string;
};

type QuickShoppingItem = {
  name: string;
  quantity: string;
  category: string;
};

type QuickCaptureResult = {
  mode: AddMode;
  draft: Partial<Draft>;
  shoppingItems?: QuickShoppingItem[];
};

const navItems: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "today", label: "Ma", icon: homeOutline },
  { id: "calendar", label: "Naptár", icon: calendarClearOutline },
  { id: "chores", label: "Házimunka", icon: checkmarkDoneCircleOutline },
  { id: "shopping", label: "Bevásárlás", icon: cartOutline },
];

const toneOptions: Array<{ value: Tone; label: string }> = [
  { value: "violet", label: "Lila" },
  { value: "blue", label: "Kék" },
  { value: "coral", label: "Korall" },
  { value: "mint", label: "Menta" },
  { value: "orange", label: "Narancs" },
  { value: "green", label: "Zöld" },
  { value: "pink", label: "Rózsaszín" },
  { value: "yellow", label: "Sárga" },
];

function localIsoDate(date = new Date()) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localIsoDate(date);
}

function dateFromIso(dateIso: string) {
  return new Date(`${dateIso}T12:00:00`);
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function longDate(dateIso = localIsoDate()) {
  return capitalize(new Intl.DateTimeFormat("hu-HU", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(dateFromIso(dateIso)));
}

function monthYear(dateIso: string) {
  return new Intl.DateTimeFormat("hu-HU", { year: "numeric", month: "long" }).format(dateFromIso(dateIso));
}

function eventDayLabel(dateIso: string) {
  const today = localIsoDate();
  if (dateIso === today) return "Ma";
  if (dateIso === addDays(today, 1)) return "Holnap";
  return capitalize(new Intl.DateTimeFormat("hu-HU", { weekday: "long" }).format(dateFromIso(dateIso)));
}

function weekDates(anchorIso: string) {
  const anchor = dateFromIso(anchorIso);
  const mondayOffset = (anchor.getDay() + 6) % 7;
  const monday = addDays(anchorIso, -mondayOffset);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

function displayFirstName(actor: Actor | null) {
  const source = actor?.displayName || actor?.username || "Olivér";
  return source.split(/[\s@]/)[0] || "Olivér";
}

function formatForint(value: string | number | null | undefined) {
  if (value == null || value === "") return "–";
  return `${Math.round(Number(value)).toLocaleString("hu-HU")} Ft`;
}

function priceSourceLabel(source: PriceOffer["source"]) {
  if (source === "gvh") return "GVH maximumár";
  if (source === "manual") return "Saját ár";
  if (source === "tesco") return "Online ár";
  return "Aktuális akció";
}

function initialDraft(): Draft {
  return {
    title: "",
    date: addDays(localIsoDate(), 1),
    startTime: "09:00",
    departureTime: "",
    person: "Család",
    driver: "Egyeztetésre vár",
    place: "",
    kind: "other",
    reminderMinutes: 1440,
    reminderEnabled: true,
    room: "Otthon",
    assignee: "Közös",
    dueLabel: "Ma",
    repeatRule: "none",
    quantity: "1 db",
    category: "Egyéb",
  };
}

function folded(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("hu-HU");
}

function nextWeekdayIso(day: number) {
  const today = new Date(`${localIsoDate()}T12:00:00`);
  const distance = (day - today.getDay() + 7) % 7 || 7;
  return addDays(localIsoDate(), distance);
}

function dateFromQuickText(value: string) {
  const normalized = folded(value);
  if (normalized.includes("holnaputan")) return addDays(localIsoDate(), 2);
  if (normalized.includes("holnap")) return addDays(localIsoDate(), 1);
  if (/(^|\s)ma(?:\s|$)/.test(normalized)) return localIsoDate();

  const weekdays: Array<[string, number]> = [
    ["hetfo", 1], ["kedd", 2], ["szerda", 3], ["csutortok", 4],
    ["pentek", 5], ["szombat", 6], ["vasarnap", 0],
  ];
  const weekday = weekdays.find(([name]) => normalized.includes(name));
  return weekday ? nextWeekdayIso(weekday[1]) : addDays(localIsoDate(), 1);
}

function timeFromQuickText(value: string) {
  const match = value.match(/\b([01]?\d|2[0-3])(?:(?:[:.])([0-5]\d)|\s*(?:óra(?:kor)?|-?kor))\b/i);
  if (!match) return "09:00";
  return `${match[1].padStart(2, "0")}:${(match[2] || "00").padStart(2, "0")}`;
}

function personFromQuickText(value: string) {
  return value.match(/@([\p{L}][\p{L}\d-]*)/u)?.[1] || "Család";
}

function shoppingCategory(name: string) {
  const normalized = folded(name);
  if (/(tej|vaj|sajt|joghurt|kefir|tejfol|tojas)/.test(normalized)) return "Tejtermék és tojás";
  if (/(kenyer|kifli|zsemle|peksutemeny)/.test(normalized)) return "Pékáru";
  if (/(alma|banan|narancs|paradicsom|paprika|uborka|krumpli|hagyma|zoldseg|gyumolcs)/.test(normalized)) return "Zöldség és gyümölcs";
  if (/(hus|sonka|szalami|virsli|hal)/.test(normalized)) return "Hús és felvágott";
  if (/(mososzer|oblito|mosogato|szivacs|papirtorlo|wc papir|szemeteszsak)/.test(normalized)) return "Háztartás";
  if (/(pelenka|torlokendo|sampon|tusfurdo|fogkrem|szappan)/.test(normalized)) return "Drogéria";
  return "Egyéb";
}

function shoppingItemFromText(value: string): QuickShoppingItem {
  const cleaned = value.trim().replace(/^(vegy(?:el|unk)|venni|bevasarlas)\s+/i, "");
  const amount = cleaned.match(/^(\d+(?:[,.]\d+)?\s*(?:db|kg|g|l|liter|csomag|doboz|üveg|uveg)?)\s+(.+)$/i);
  const name = (amount?.[2] || cleaned).trim();
  return { name, quantity: amount?.[1] || "1 db", category: shoppingCategory(name) };
}

function parseQuickCapture(value: string, preferredMode: AddMode): QuickCaptureResult {
  const normalized = folded(value);
  const eventSignal = /(orvos|kontroll|vizsgalat|idopont|fejlesztes|iskola|ovoda|fogasz|korhaz|rendelo)/.test(normalized)
    || /\b(?:ma|holnap|holnaputan|hetfo|kedd|szerda|csutortok|pentek|szombat|vasarnap)\b/.test(normalized)
    || /\b([01]?\d|2[0-3])(?:(?:[:.])[0-5]\d|\s*(?:ora(?:kor)?|-?kor))\b/.test(normalized);
  const choreSignal = /(porszivoz|felmos|mosogatas|mosogatni|mosas\b|mosni|takarit|szemetet|agynemucsere|portorles|ablakpucol)/.test(normalized);
  const mode: AddMode = eventSignal ? "event" : choreSignal ? "chore" : preferredMode;

  if (mode === "shopping") {
    const parts = value.split(/[,;]|\s+és\s+/i).map((item) => item.trim()).filter(Boolean);
    const shoppingItems = parts.map(shoppingItemFromText).filter((item) => item.name);
    const first = shoppingItems[0];
    return {
      mode,
      shoppingItems,
      draft: first ? { title: first.name, quantity: first.quantity, category: first.category } : {},
    };
  }

  const mention = value.match(/@[\p{L}][\p{L}\d-]*/u)?.[0] || "";
  const timePattern = /\b([01]?\d|2[0-3])(?:(?:[:.])([0-5]\d)|\s*(?:óra(?:kor)?|-?kor))\b/gi;
  const dateWords = /\b(?:ma|holnapután|holnap|hétfőn?|kedden?|szerdán?|csütörtökön?|pénteken?|szombaton?|vasárnap)\b/gi;
  const repeatRule: RepeatRule = /(minden nap|naponta)/.test(normalized) ? "daily"
    : /(hetente|minden heten)/.test(normalized) ? "weekly"
      : /(havonta|minden honapban)/.test(normalized) ? "monthly" : "none";
  const title = value
    .replace(mention, "")
    .replace(timePattern, "")
    .replace(dateWords, "")
    .replace(/\b(?:minden nap|naponta|hetente|minden héten|havonta|minden hónapban)\b/gi, "")
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, "")
    .replace(/\s{2,}/g, " ");

  if (mode === "event") {
    const kind: EventKind = /(orvos|kontroll|vizsgalat|fogasz|korhaz|rendelo)/.test(normalized)
      ? "medical"
      : /(iskola|ovoda|szulo)/.test(normalized) ? "school" : "other";
    return {
      mode,
      draft: {
        title: title || "Családi esemény",
        date: dateFromQuickText(value),
        startTime: timeFromQuickText(value),
        person: personFromQuickText(value),
        kind,
        repeatRule,
      },
    };
  }

  const room = normalized.includes("konyha") ? "Konyha"
    : normalized.includes("furdo") ? "Fürdő"
      : normalized.includes("halo") ? "Hálószoba"
        : normalized.includes("gyerekszoba") ? "Gyerekszoba" : "Otthon";
  return {
    mode,
    draft: {
      title: title || "Új házimunka",
      assignee: personFromQuickText(value) === "Család" ? "Közös" : personFromQuickText(value),
      room,
      dueLabel: normalized.includes("holnap") ? "Holnap" : "Ma",
      repeatRule,
    },
  };
}

function nextMonthlyDate(dateIso: string) {
  const date = dateFromIso(dateIso);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return localIsoDate(date);
}

function expandedEvents(events: FamilyEvent[]) {
  const firstVisible = addDays(localIsoDate(), -14);
  const lastVisible = addDays(localIsoDate(), 180);
  const expanded: FamilyEvent[] = [];

  for (const event of events) {
    const rule = event.repeatRule || "none";
    if (rule === "none") {
      expanded.push(event);
      continue;
    }
    let occurrence = event.date;
    let guard = 0;
    while (occurrence <= lastVisible && guard < 400) {
      if (occurrence >= firstVisible) expanded.push({ ...event, date: occurrence });
      occurrence = rule === "daily" ? addDays(occurrence, 1)
        : rule === "weekly" ? addDays(occurrence, 7)
          : nextMonthlyDate(occurrence);
      guard += 1;
    }
  }

  return expanded.sort((a, b) => `${a.date}${a.startTime}${a.id}`.localeCompare(`${b.date}${b.startTime}${b.id}`));
}

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = window.atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function apiRequest<T>(method: string, body?: unknown, path = "/api/household"): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new ApiError(payload.error || "A művelet nem sikerült.", response.status);
  return payload;
}

function EventIcon({ kind }: { kind: EventKind }) {
  return <IonIcon icon={kind === "medical" ? medicalOutline : kind === "school" ? schoolOutline : calendarClearOutline} />;
}

function SearchOfferList({ offers }: { offers: PriceSearchOffer[] }) {
  if (!offers.length) return <p className="search-offers-empty">Aktuális ár még nincs.</p>;
  return <div className="search-offers">{offers.map((offer) => <div key={`${offer.source}-${offer.chainName}`}>
    <span><strong>{offer.chainName}</strong><small>{offer.source === "gvh" ? "GVH maximumár" : offer.source === "manual" ? "Saját ár" : offer.promotionLabel || "Aktuális ár"}{offer.validUntil ? ` · ${offer.validUntil}-ig` : ""}</small></span>
    <strong>{offer.source === "gvh" ? "max. " : ""}{formatForint(offer.promotionPrice || offer.price)}{offer.promotionPrice && <small>{formatForint(offer.price)}</small>}</strong>
  </div>)}</div>;
}

export default function OtthonApp() {
  const [tab, setTab] = useState<Tab>("today");
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [actor, setActor] = useState<Actor | null>(null);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [authMode, setAuthMode] = useState<AuthMode>("checking");
  const [accountOpen, setAccountOpen] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [addMode, setAddMode] = useState<AddMode>("shopping");
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [quickText, setQuickText] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [priceItem, setPriceItem] = useState<ShoppingItem | null>(null);
  const [priceQuery, setPriceQuery] = useState("");
  const [priceResults, setPriceResults] = useState<PriceSearchResult[]>([]);
  const [priceWatch, setPriceWatch] = useState<PriceWatchDetail | null>(null);
  const [targetPrice, setTargetPrice] = useState("");
  const [priceBusy, setPriceBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanCode, setScanCode] = useState("");
  const [scanResults, setScanResults] = useState<PriceSearchResult[]>([]);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState("");
  const [manualStore, setManualStore] = useState("Aldi");
  const [manualPrice, setManualPrice] = useState("");

  const loadHousehold = useCallback(async (silent = false) => {
    if (!silent) setSyncing(true);
    try {
      const data = await apiRequest<HouseholdResponse>("GET");
      setActor(data.actor);
      setEvents(data.events);
      setChores(data.chores);
      setShopping(data.shopping);
      setFamilyMembers(data.familyMembers || []);
      setAuthMode("authenticated");
      setError("");
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        setActor(null);
        setAuthMode("login");
        setError("");
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "Nem sikerült betölteni a közös adatokat.");
    } finally {
      setReady(true);
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js")
        .then((registration) => registration.pushManager?.getSubscription())
        .then((subscription) => setNotificationsEnabled(Boolean(subscription)))
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.requestAnimationFrame(() => {
      void apiRequest<{ actor: Actor | null; setupRequired: boolean }>("GET", undefined, "/api/auth/state")
        .then((state) => {
          if (state.actor) {
            setActor(state.actor);
            setAuthMode("authenticated");
            void loadHousehold();
          } else {
            setAuthMode(state.setupRequired ? "setup" : "login");
            setReady(true);
          }
        })
        .catch((failure) => {
          setError(failure instanceof Error ? failure.message : "Nem sikerült kapcsolódni.");
          setAuthMode("login");
          setReady(true);
        });
    });
    return () => window.cancelAnimationFrame(initialLoad);
  }, [loadHousehold]);

  useEffect(() => {
    if (authMode !== "authenticated") return;
    const interval = window.setInterval(() => {
      void loadHousehold(true);
    }, 8_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadHousehold(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [authMode, loadHousehold]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const remainingChores = chores.filter((item) => !item.done).length;
  const remainingShopping = shopping.filter((item) => !item.checked).length;
  const choreProgress = chores.length ? Math.round(((chores.length - remainingChores) / chores.length) * 100) : 0;
  const shoppingGroups = useMemo(() => {
    return shopping.reduce<Record<string, ShoppingItem[]>>((groups, item) => {
      (groups[item.category] ||= []).push(item);
      return groups;
    }, {});
  }, [shopping]);
  const visibleEvents = useMemo(() => expandedEvents(events), [events]);

  function showFailure(failure: unknown) {
    const message = failure instanceof Error ? failure.message : "A művelet nem sikerült.";
    setToast(message);
  }

  async function toggleChore(id: number) {
    const current = chores.find((item) => item.id === id);
    if (!current) return;
    const nextDone = !current.done;
    setChores((items) => items.map((item) => item.id === id ? { ...item, done: nextDone } : item));
    try {
      await apiRequest("PATCH", { type: "chore", id, done: nextDone });
      setToast(nextDone ? "Feladat kész" : "Feladat visszanyitva");
    } catch (failure) {
      setChores((items) => items.map((item) => item.id === id ? current : item));
      showFailure(failure);
    }
  }

  async function claimChore(id: number) {
    const current = chores.find((item) => item.id === id);
    if (!current || !actor || current.done) return;
    const optimistic = { ...current, assignee: actor.displayName };
    setChores((items) => items.map((item) => item.id === id ? optimistic : item));
    try {
      const { record } = await apiRequest<{ record: Chore }>("PATCH", { type: "chore", id, action: "claim" });
      setChores((items) => items.map((item) => item.id === id ? record : item));
      setToast("Feladat átvállalva");
    } catch (failure) {
      setChores((items) => items.map((item) => item.id === id ? current : item));
      showFailure(failure);
    }
  }

  async function toggleShopping(id: number) {
    const current = shopping.find((item) => item.id === id);
    if (!current) return;
    const checked = !current.checked;
    setShopping((items) => items.map((item) => item.id === id ? { ...item, checked } : item));
    try {
      await apiRequest("PATCH", { type: "shopping", id, checked });
    } catch (failure) {
      setShopping((items) => items.map((item) => item.id === id ? current : item));
      showFailure(failure);
    }
  }

  async function deleteItem(type: AddMode, id: number, title: string) {
    if (!window.confirm(`Biztosan törlöd: ${title}?`)) return;
    try {
      await apiRequest("DELETE", { type, id });
      if (type === "event") setEvents((items) => items.filter((item) => item.id !== id));
      if (type === "chore") setChores((items) => items.filter((item) => item.id !== id));
      if (type === "shopping") setShopping((items) => items.filter((item) => item.id !== id));
      setToast("Törölve");
    } catch (failure) {
      showFailure(failure);
    }
  }

  async function clearCompletedShopping() {
    if (!window.confirm("Töröljük az összes megvásárolt tételt?")) return;
    try {
      await apiRequest("DELETE", { type: "shoppingCompleted" });
      setShopping((items) => items.filter((item) => !item.checked));
      setToast("A megvásárolt tételek törölve");
    } catch (failure) {
      showFailure(failure);
    }
  }

  function openBarcodeScanner() {
    setScanCode("");
    setScanResults([]);
    setScanError("");
    setScanBusy(false);
    setScannerOpen(true);
  }

  const handleBarcodeDetected = useCallback(async (code: string) => {
    setScanCode(code);
    setScanBusy(true);
    setScanError("");
    try {
      const result = await apiRequest<{ results: PriceSearchResult[] }>("GET", undefined, `/api/prices?barcode=${encodeURIComponent(code)}`);
      setScanResults(result.results);
      if (!result.results.length) setScanError("Ezt a vonalkódot most egyik termékadatbázisban sem találtam meg.");
    } catch (failure) {
      setScanError(failure instanceof Error ? failure.message : "A vonalkód keresése nem sikerült.");
    } finally {
      setScanBusy(false);
    }
  }, []);

  const handleScannerError = useCallback((message: string) => setScanError(message), []);

  async function addScannedProduct(product: PriceSearchResult, withPriceWatch: boolean) {
    if (scanBusy) return;
    setScanBusy(true);
    try {
      const { record } = await apiRequest<{ record: ShoppingItem }>("POST", {
        action: "addToShopping",
        productId: product.productId,
        withPriceWatch,
      }, "/api/prices");
      setShopping((items) => [record, ...items]);
      setScannerOpen(false);
      setToast(withPriceWatch ? "Listához adva, árfigyeléssel" : "Hozzáadva a bevásárlólistához");
    } catch (failure) {
      showFailure(failure);
    } finally {
      setScanBusy(false);
    }
  }

  function addUnknownBarcodeManually() {
    setScannerOpen(false);
    openAdd("shopping");
    setToast("Nem találtuk az adatbázisokban — add meg kézzel");
  }

  async function searchPrices(query = priceQuery) {
    if (query.trim().length < 2) return;
    setPriceBusy(true);
    try {
      const result = await apiRequest<{ results: PriceSearchResult[] }>("GET", undefined, `/api/prices?q=${encodeURIComponent(query.trim())}`);
      setPriceResults(result.results);
      if (!result.results.length) setToast("Nem találtam ilyen terméket a jelenlegi forrásokban");
    } catch (failure) {
      showFailure(failure);
    } finally {
      setPriceBusy(false);
    }
  }

  async function openPriceMonitor(item: ShoppingItem) {
    setPriceItem(item);
    setPriceQuery(item.name);
    setPriceResults([]);
    setPriceWatch(null);
    setTargetPrice(item.priceWatch?.targetPrice || "");
    setPriceBusy(true);
    try {
      const result = await apiRequest<{ watch: PriceWatchDetail | null }>("GET", undefined, `/api/prices?shoppingItemId=${item.id}`);
      setPriceWatch(result.watch);
      if (result.watch) setTargetPrice(result.watch.targetPrice || "");
      else await searchPrices(item.name);
    } catch (failure) {
      showFailure(failure);
    } finally {
      setPriceBusy(false);
    }
  }

  async function recordManualPrice() {
    if (!priceItem || !priceWatch || !manualPrice.trim()) return;
    setPriceBusy(true);
    try {
      const result = await apiRequest<{ watch: PriceWatchDetail }>("POST", {
        action: "recordPrice",
        shoppingItemId: priceItem.id,
        productId: priceWatch.productId,
        chainName: manualStore,
        price: manualPrice,
      }, "/api/prices");
      setPriceWatch(result.watch);
      setManualPrice("");
      await loadHousehold(true);
      setToast("Saját ár elmentve");
    } catch (failure) {
      showFailure(failure);
    } finally {
      setPriceBusy(false);
    }
  }

  async function savePriceWatch(productId: string) {
    if (!priceItem) return;
    setPriceBusy(true);
    try {
      const result = await apiRequest<{ watch: PriceWatchDetail }>("POST", { shoppingItemId: priceItem.id, productId, targetPrice }, "/api/prices");
      setPriceWatch(result.watch);
      setPriceResults([]);
      await loadHousehold(true);
      setToast("Árfigyelés bekapcsolva");
    } catch (failure) {
      showFailure(failure);
    } finally {
      setPriceBusy(false);
    }
  }

  async function createManualPriceWatch() {
    if (!priceItem) return;
    setPriceBusy(true);
    try {
      const result = await apiRequest<{ watch: PriceWatchDetail }>("POST", {
        action: "createManualWatch",
        shoppingItemId: priceItem.id,
        targetPrice,
      }, "/api/prices");
      setPriceWatch(result.watch);
      setPriceResults([]);
      await loadHousehold(true);
      setToast("Saját árfigyelés bekapcsolva");
    } catch (failure) {
      showFailure(failure);
    } finally {
      setPriceBusy(false);
    }
  }

  async function removePriceWatch() {
    if (!priceItem) return;
    setPriceBusy(true);
    try {
      await apiRequest("DELETE", { shoppingItemId: priceItem.id }, "/api/prices");
      await loadHousehold(true);
      setPriceItem(null);
      setPriceWatch(null);
      setToast("Árfigyelés kikapcsolva");
    } catch (failure) {
      showFailure(failure);
    } finally {
      setPriceBusy(false);
    }
  }

  async function logout() {
    try {
      await apiRequest("POST", {}, "/api/auth/logout");
    } catch {
      // A helyi kijelentkezés akkor is megtörténik, ha a hálózat közben megszakadt.
    }
    setAccountOpen(false);
    setActor(null);
    setEvents([]);
    setChores([]);
    setShopping([]);
    setFamilyMembers([]);
    setAuthMode("login");
    setReady(true);
  }

  async function completeAuth(nextActor: Actor) {
    setActor(nextActor);
    setAuthMode("authenticated");
    setReady(false);
    await loadHousehold();
  }

  async function enableNotifications() {
    try {
      const standalone = window.matchMedia("(display-mode: standalone)").matches
        || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
      if (!standalone) {
        setToast("Előbb tedd ki az Otthont az iPhone kezdőképernyőjére");
        return;
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setToast("Ezen az eszközön nem érhető el a webes értesítés");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setToast("Az értesítési engedély nem lett megadva");
        return;
      }
      const { publicKey } = await apiRequest<{ publicKey: string }>("GET", undefined, "/api/push/public-key");
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey),
      });
      await apiRequest("POST", subscription.toJSON(), "/api/push/subscribe");
      setNotificationsEnabled(true);
      setToast("Az értesítések bekapcsolva");
    } catch (failure) {
      showFailure(failure);
    }
  }

  function openAdd(mode: AddMode) {
    setEditingItemId(null);
    setAddMode(mode);
    setDraft(initialDraft());
    setQuickText("");
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    setEditingItemId(null);
  }

  function openEditEvent(selectedEvent: FamilyEvent) {
    const event = events.find((item) => item.id === selectedEvent.id) || selectedEvent;
    setEditingItemId(event.id);
    setAddMode("event");
    setDraft({
      ...initialDraft(),
      title: event.title,
      date: event.date,
      startTime: event.startTime,
      departureTime: event.departureTime || "",
      person: event.person,
      driver: event.driver,
      place: event.place === "Helyszín nélkül" ? "" : event.place,
      kind: event.kind,
      repeatRule: event.repeatRule,
      reminderMinutes: event.reminderMinutes,
      reminderEnabled: event.reminderEnabled,
    });
    setQuickText("");
    setSheetOpen(true);
  }

  function openEditChore(chore: Chore) {
    setEditingItemId(chore.id);
    setAddMode("chore");
    setDraft({
      ...initialDraft(),
      title: chore.title,
      room: chore.room,
      assignee: chore.assignee,
      dueLabel: chore.dueLabel,
      repeatRule: chore.repeatRule,
    });
    setQuickText("");
    setSheetOpen(true);
  }

  function openEditShopping(item: ShoppingItem) {
    setEditingItemId(item.id);
    setAddMode("shopping");
    setDraft({
      ...initialDraft(),
      title: item.name,
      quantity: item.quantity,
      category: item.category,
    });
    setQuickText("");
    setSheetOpen(true);
  }

  async function deleteEditingItem() {
    if (!editingItemId || !window.confirm(`Biztosan törlöd: ${draft.title}?`)) return;
    setSaving(true);
    try {
      await apiRequest("DELETE", { type: addMode, id: editingItemId });
      if (addMode === "event") setEvents((items) => items.filter((item) => item.id !== editingItemId));
      if (addMode === "chore") setChores((items) => items.filter((item) => item.id !== editingItemId));
      if (addMode === "shopping") setShopping((items) => items.filter((item) => item.id !== editingItemId));
      setToast(addMode === "event" ? "Esemény törölve" : addMode === "chore" ? "Feladat törölve" : "Tétel törölve");
      closeSheet();
    } catch (failure) {
      showFailure(failure);
    } finally {
      setSaving(false);
    }
  }

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function applyQuickCapture() {
    if (!quickText.trim() || saving) return;
    const parsed = parseQuickCapture(quickText, addMode);
    if (parsed.mode === "shopping" && (parsed.shoppingItems?.length || 0) > 1) {
      setSaving(true);
      try {
        const records: ShoppingItem[] = [];
        for (const item of parsed.shoppingItems || []) {
          const result = await apiRequest<{ record: ShoppingItem }>("POST", { type: "shopping", ...item });
          records.push(result.record);
        }
        setShopping((items) => [...records.reverse(), ...items]);
        setToast(`${records.length} tétel hozzáadva`);
        setSheetOpen(false);
      } catch (failure) {
        showFailure(failure);
        void loadHousehold(true);
      } finally {
        setSaving(false);
      }
      return;
    }

    setAddMode(parsed.mode);
    setDraft({ ...initialDraft(), ...parsed.draft });
    setQuickText("");
    setToast("Kitöltöttem — nézd át, aztán mentsd el");
  }

  async function submitNewItem(event: FormEvent) {
    event.preventDefault();
    if (!draft.title.trim() || saving) return;
    setSaving(true);
    try {
      if (addMode === "event") {
        const eventPayload = {
          type: "event",
          ...(editingItemId ? { id: editingItemId } : {}),
          title: draft.title,
          date: draft.date,
          startTime: draft.startTime,
          departureTime: draft.departureTime,
          person: draft.person,
          driver: draft.driver,
          place: draft.place,
          kind: draft.kind,
          repeatRule: draft.repeatRule,
          reminderMinutes: draft.reminderMinutes,
          reminderEnabled: draft.reminderEnabled,
          tone: familyMembers.find((member) => member.name.toLocaleLowerCase("hu-HU") === draft.person.toLocaleLowerCase("hu-HU"))?.tone
            || (draft.kind === "medical" ? "violet" : draft.kind === "school" ? "blue" : "mint"),
        };
        const { record } = await apiRequest<{ record: FamilyEvent }>(editingItemId ? "PATCH" : "POST", eventPayload);
        setEvents((items) => (editingItemId
          ? items.map((item) => item.id === editingItemId ? record : item)
          : [...items, record]
        ).sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)));
        setToast(editingItemId ? "Esemény módosítva" : "Új esemény felvéve");
      } else if (addMode === "chore") {
        const { record } = await apiRequest<{ record: Chore }>(editingItemId ? "PATCH" : "POST", {
          type: "chore",
          ...(editingItemId ? { id: editingItemId, action: "update" } : {}),
          title: draft.title,
          room: draft.room,
          assignee: draft.assignee,
          dueLabel: draft.dueLabel,
          repeatRule: draft.repeatRule,
        });
        setChores((items) => editingItemId ? items.map((item) => item.id === editingItemId ? record : item) : [record, ...items]);
        setToast(editingItemId ? "Házimunka módosítva" : "Új házimunka felvéve");
      } else {
        const { record } = await apiRequest<{ record: ShoppingItem }>(editingItemId ? "PATCH" : "POST", {
          type: "shopping",
          ...(editingItemId ? { id: editingItemId, action: "update" } : {}),
          name: draft.title,
          quantity: draft.quantity,
          category: draft.category,
        });
        setShopping((items) => editingItemId ? items.map((item) => item.id === editingItemId ? record : item) : [record, ...items]);
        setToast(editingItemId ? "Bevásárlási tétel módosítva" : "Hozzáadva a bevásárlólistához");
      }
      closeSheet();
    } catch (failure) {
      showFailure(failure);
    } finally {
      setSaving(false);
    }
  }

  return (
    <IonApp>
      <div className="app-shell">
        {error && <button type="button" className="error-banner" onClick={() => void loadHousehold()}>{error} · Újrapróbálom</button>}
        <main className="app-content" aria-busy={!ready || syncing}>
          {authMode !== "authenticated" ? (
            <AuthView mode={authMode} error={error} onSuccess={completeAuth} />
          ) : !ready ? (
            <div className="screen loading-screen"><span className="loading-orb" /><h1>Otthon</h1><p>A közös adatok betöltése…</p></div>
          ) : (
            <>
              {tab === "today" && (
                <TodayView
                  actor={actor} events={visibleEvents} chores={chores} shopping={shopping}
                  remainingChores={remainingChores} remainingShopping={remainingShopping}
                  syncing={syncing} onTab={setTab} onToggleChore={toggleChore}
                  notificationsEnabled={notificationsEnabled} onEnableNotifications={enableNotifications}
                  onAccount={() => setAccountOpen(true)}
                  onAddEvent={() => openAdd("event")} onEditEvent={openEditEvent}
                />
              )}
              {tab === "calendar" && <CalendarView events={visibleEvents} onEdit={openEditEvent} onDelete={(id, title) => deleteItem("event", id, title)} />}
              {tab === "chores" && (
                <ChoresView actor={actor} familyMembers={familyMembers} chores={chores} progress={choreProgress} onToggle={toggleChore} onClaim={claimChore} onEdit={openEditChore} onDelete={(id, title) => deleteItem("chore", id, title)} />
              )}
              {tab === "shopping" && (
                <ShoppingView
                  groups={shoppingGroups} remaining={remainingShopping} onToggle={toggleShopping}
                  onEdit={openEditShopping}
                  onPrice={openPriceMonitor}
                  onDelete={(id, title) => deleteItem("shopping", id, title)}
                  onClear={clearCompletedShopping} onQuickAdd={() => openAdd("shopping")}
                  onScan={openBarcodeScanner}
                />
              )}
            </>
          )}
        </main>

        {ready && authMode === "authenticated" && <button
          type="button" className="fab" aria-label="Új elem hozzáadása"
          onClick={() => openAdd(tab === "calendar" ? "event" : tab === "chores" ? "chore" : "shopping")}
        ><IonIcon icon={add} /></button>}

        {ready && authMode === "authenticated" && <nav className="tab-bar" aria-label="Fő navigáció">
          {navItems.map((item) => (
            <button
              type="button" key={item.id} className={tab === item.id ? "tab-button active" : "tab-button"}
              onClick={() => setTab(item.id)} aria-current={tab === item.id ? "page" : undefined}
            ><IonIcon icon={item.icon} /><span>{item.label}</span></button>
          ))}
        </nav>}

        {sheetOpen && (
          <div className="sheet-backdrop" role="presentation" onMouseDown={() => !saving && closeSheet()}>
            <section className="add-sheet" role="dialog" aria-modal="true" aria-labelledby="add-title" onMouseDown={(sheetEvent) => sheetEvent.stopPropagation()}>
              <div className="sheet-handle" />
              <div className="sheet-heading">
                <div><span className="eyebrow">{editingItemId ? addMode === "event" ? "Esemény" : addMode === "chore" ? "Házimunka" : "Bevásárlás" : "Gyors hozzáadás"}</span><h2 id="add-title">{editingItemId ? "Szerkesztés" : "Mi kerüljön be?"}</h2></div>
                <button type="button" className="icon-button subtle" onClick={closeSheet} aria-label="Bezárás" disabled={saving}><IonIcon icon={close} /></button>
              </div>
              {!editingItemId && <><div className="smart-capture">
                <span className="smart-capture-icon"><IonIcon icon={sparklesOutline} /></span>
                <label>
                  <span>Mondd vagy írd le egyben</span>
                  <input
                    value={quickText}
                    onChange={(inputEvent) => setQuickText(inputEvent.target.value)}
                    onKeyDown={(keyEvent) => {
                      if (keyEvent.key === "Enter") {
                        keyEvent.preventDefault();
                        void applyQuickCapture();
                      }
                    }}
                    placeholder="pl. pénteken 14:30 kontroll @Emma"
                    aria-label="Gyors diktálás vagy bevitel"
                    autoFocus
                  />
                </label>
                <button type="button" onClick={() => void applyQuickCapture()} disabled={!quickText.trim() || saving}>Kitöltöm</button>
              </div>
              <p className="smart-capture-help">Az iPhone billentyűzet mikrofonjával diktálhatsz. Több bevásárlást vesszővel válassz el.</p></>}
              {!editingItemId && <div className="mode-picker" role="tablist" aria-label="Elem típusa">
                <button type="button" role="tab" className={addMode === "event" ? "active" : ""} aria-selected={addMode === "event"} onClick={() => setAddMode("event")}>Esemény</button>
                <button type="button" role="tab" className={addMode === "chore" ? "active" : ""} aria-selected={addMode === "chore"} onClick={() => setAddMode("chore")}>Házimunka</button>
                <button type="button" role="tab" className={addMode === "shopping" ? "active" : ""} aria-selected={addMode === "shopping"} onClick={() => setAddMode("shopping")}>Bevásárlás</button>
              </div>}
              <form onSubmit={submitNewItem} className="add-form">
                <label className="full-field"><span>{addMode === "event" ? "Esemény neve" : addMode === "chore" ? "Feladat neve" : "Mi fogyott el?"}</span>
                  <input value={draft.title} onChange={(inputEvent) => updateDraft("title", inputEvent.target.value)} placeholder={addMode === "event" ? "pl. kontrollvizsgálat" : addMode === "chore" ? "pl. ágyneműcsere" : "pl. tej"} required />
                </label>

                {addMode === "event" && <div className="form-grid">
                  <label><span>Dátum</span><input type="date" value={draft.date} onChange={(inputEvent) => updateDraft("date", inputEvent.target.value)} required /></label>
                  <label><span>Időpont</span><input type="time" value={draft.startTime} onChange={(inputEvent) => updateDraft("startTime", inputEvent.target.value)} required /></label>
                  <label><span>Indulás</span><input type="time" value={draft.departureTime} onChange={(inputEvent) => updateDraft("departureTime", inputEvent.target.value)} /></label>
                  <label><span>Kihez tartozik?</span><input list="family-member-names" value={draft.person} onChange={(inputEvent) => updateDraft("person", inputEvent.target.value)} placeholder="pl. Emma" /><datalist id="family-member-names">{familyMembers.map((member) => <option value={member.name} key={member.id} />)}</datalist></label>
                  <label className="wide"><span>Helyszín</span><input value={draft.place} onChange={(inputEvent) => updateDraft("place", inputEvent.target.value)} placeholder="pl. Budapest" /></label>
                  <label><span>Ki viszi?</span><input value={draft.driver} onChange={(inputEvent) => updateDraft("driver", inputEvent.target.value)} /></label>
                  <label><span>Típus</span><select value={draft.kind} onChange={(inputEvent) => updateDraft("kind", inputEvent.target.value as EventKind)}><option value="other">Egyéb</option><option value="medical">Orvosi</option><option value="school">Iskolai</option></select></label>
                  <label className="wide"><span>Ismétlődés</span><select value={draft.repeatRule} onChange={(inputEvent) => updateDraft("repeatRule", inputEvent.target.value as RepeatRule)}><option value="none">Nem ismétlődik</option><option value="daily">Naponta</option><option value="weekly">Hetente</option><option value="monthly">Havonta</option></select></label>
                  <label className="wide"><span>Plusz emlékeztető</span><select value={draft.reminderEnabled ? String(draft.reminderMinutes) : "off"} onChange={(inputEvent) => inputEvent.target.value === "off" ? setDraft((current) => ({ ...current, reminderEnabled: false })) : setDraft((current) => ({ ...current, reminderEnabled: true, reminderMinutes: Number(inputEvent.target.value) }))}><option value="off">Csak 15 perccel előtte</option><option value="30">15 és 30 perccel előtte</option><option value="120">15 perccel és 2 órával előtte</option><option value="1440">15 perccel és 1 nappal előtte</option></select></label>
                </div>}

                {addMode === "chore" && <div className="form-grid">
                  <label><span>Helyiség</span><input value={draft.room} onChange={(inputEvent) => updateDraft("room", inputEvent.target.value)} /></label>
                  <label><span>Felelős</span><input value={draft.assignee} onChange={(inputEvent) => updateDraft("assignee", inputEvent.target.value)} /></label>
                  <label className="wide"><span>Határidő</span><input value={draft.dueLabel} onChange={(inputEvent) => updateDraft("dueLabel", inputEvent.target.value)} placeholder="pl. Ma · 18:00" /></label>
                  <label className="wide"><span>Ismétlődés</span><select value={draft.repeatRule} onChange={(inputEvent) => updateDraft("repeatRule", inputEvent.target.value as RepeatRule)}><option value="none">Nem ismétlődik</option><option value="daily">Naponta</option><option value="weekly">Hetente</option><option value="monthly">Havonta</option></select></label>
                </div>}

                {addMode === "shopping" && <div className="form-grid">
                  <label><span>Mennyiség</span><input value={draft.quantity} onChange={(inputEvent) => updateDraft("quantity", inputEvent.target.value)} /></label>
                  <label><span>Kategória</span><input value={draft.category} onChange={(inputEvent) => updateDraft("category", inputEvent.target.value)} /></label>
                </div>}

                <button type="submit" className="primary-button" disabled={!draft.title.trim() || saving}><IonIcon icon={editingItemId ? checkmark : add} /> {saving ? "Mentés…" : editingItemId ? "Módosítások mentése" : "Hozzáadás"}</button>
                {editingItemId && <button type="button" className="sheet-delete-button" disabled={saving} onClick={() => void deleteEditingItem()}><IonIcon icon={trashOutline} /> {addMode === "event" ? "Esemény" : addMode === "chore" ? "Feladat" : "Tétel"} törlése</button>}
              </form>
            </section>
          </div>
        )}

        {scannerOpen && (
          <div className="sheet-backdrop scanner-backdrop" role="presentation" onMouseDown={() => !scanBusy && setScannerOpen(false)}>
            <section className="add-sheet scanner-sheet" role="dialog" aria-modal="true" aria-labelledby="scanner-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="sheet-handle" />
              <div className="sheet-heading"><div><span className="eyebrow">Gyors hozzáadás</span><h2 id="scanner-title">Vonalkód beolvasása</h2></div><button type="button" className="icon-button subtle" onClick={() => setScannerOpen(false)} aria-label="Bezárás" disabled={scanBusy}><IonIcon icon={close} /></button></div>
              {!scanCode && <>
                <BarcodeScanner onDetected={handleBarcodeDetected} onError={handleScannerError} />
                <p className="scanner-help">Tartsd a csomagolás vonalkódját a keret közepére. A kamera csak a beolvasás idejére kapcsol be.</p>
              </>}
              {scanCode && <div className="scan-code"><IonIcon icon={barcodeOutline} /><span>Beolvasva</span><strong>{scanCode}</strong></div>}
              {scanBusy && <div className="price-loading"><span className="loading-orb" />Termék keresése…</div>}
              {!scanBusy && scanResults.length > 0 && <div className="scan-results">{scanResults.map((product) => <article className="scan-product" key={product.productId}>
                <div className="scan-product-copy"><span>{product.sources.join(" · ")}{product.cached ? " · gyorsítótárból" : ""}</span><h3>{product.productName}</h3><p>{product.packageSize} {product.unit} · {product.offers.length} ismert ár</p><SearchOfferList offers={product.offers} /></div>
                <button type="button" className="scan-primary" onClick={() => void addScannedProduct(product, true)}><IonIcon icon={pricetagOutline} /> Listához + árfigyelés</button>
                <button type="button" className="scan-secondary" onClick={() => void addScannedProduct(product, false)}>Csak a listához</button>
              </article>)}</div>}
              {!scanBusy && scanError && <div className="scan-error"><strong>{scanError}</strong>{scanCode && <button type="button" onClick={addUnknownBarcodeManually}>Kézzel adom hozzá</button>}</div>}
              {scanCode && <button type="button" className="scan-again" onClick={openBarcodeScanner}><IonIcon icon={barcodeOutline} /> Másik vonalkód</button>}
            </section>
          </div>
        )}

        {priceItem && (
          <div className="sheet-backdrop" role="presentation" onMouseDown={() => !priceBusy && setPriceItem(null)}>
            <section className="add-sheet price-sheet" role="dialog" aria-modal="true" aria-labelledby="price-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="sheet-handle" />
              <div className="sheet-heading"><div><span className="eyebrow">Családi árfigyelő</span><h2 id="price-title">{priceItem.name}</h2></div><button type="button" className="icon-button subtle" onClick={() => setPriceItem(null)} aria-label="Bezárás"><IonIcon icon={close} /></button></div>
              {priceWatch ? <>
                <div className="tracked-product"><IonIcon icon={pricetagOutline} /><div><strong>{priceWatch.productName}</strong><span>{priceWatch.categoryName} · {priceWatch.offers.length || "nincs még"} ismert ár</span></div></div>
                {priceWatch.offers.length ? <div className="price-offers">{priceWatch.offers.map((offer, index) => <div className={index === 0 ? "price-offer best" : "price-offer"} key={`${offer.source}-${offer.chainName}`}><div><strong>{offer.chainName}<small className={`price-source ${offer.source}`}>{priceSourceLabel(offer.source)}</small></strong><span>{offer.source === "gvh" ? `${offer.storeCount} bolt · legfeljebb ${formatForint(offer.maxUnitPrice)}/${priceWatch.unit}` : offer.promotionLabel || offer.locationLabel || `Frissítve: ${offer.observedOn}`}{offer.validUntil ? ` · ${offer.validUntil}-ig` : ""}</span></div><strong>{offer.source === "gvh" ? "max. " : ""}{formatForint(offer.promotionPrice || offer.maxPrice)}{offer.promotionPrice && <small className="old-price">{formatForint(offer.maxPrice)}</small>}</strong></div>)}</div> : <div className="price-empty">A terméket figyeljük; amint valamelyik forrás árat ad hozzá, itt megjelenik.</div>}
                <label className="price-target"><span>Célár – ha ezt eléri, szólunk</span><div><input inputMode="decimal" value={targetPrice} onChange={(event) => setTargetPrice(event.target.value)} placeholder="pl. 5999" /><button type="button" onClick={() => void savePriceWatch(priceWatch.productId)} disabled={priceBusy}>Mentés</button></div></label>
                {priceWatch.history.length > 1 && <div className="price-history"><span>Legutóbbi {priceWatch.history.length} nap · legjobb ismert ár</span><div>{priceWatch.history.map((point) => <i key={point.date} title={`${point.date}: ${formatForint(point.maxPrice)}`} style={{ height: `${Math.max(12, Math.min(100, 100 - (Number(point.maxPrice) / Math.max(...priceWatch.history.map((item) => Number(item.maxPrice))) - .5) * 120))}%` }} />)}</div></div>}
                <div className="manual-price"><span>Ennyiért vettem</span><div><select value={manualStore} onChange={(event) => setManualStore(event.target.value)}><option>Tesco</option><option>Lidl</option><option>Aldi</option><option>dm</option><option>Rossmann</option><option>Egyéb</option></select><input inputMode="decimal" value={manualPrice} onChange={(event) => setManualPrice(event.target.value)} placeholder="ár (Ft)" /><button type="button" onClick={() => void recordManualPrice()} disabled={priceBusy || !manualPrice.trim()}>Mentés</button></div><small>Az Aldi és a helyi boltok blokkon látott ára így bekerül a saját előzménybe.</small></div>
                <button type="button" className="sheet-delete-button" onClick={() => void removePriceWatch()} disabled={priceBusy}><IonIcon icon={trashOutline} /> Árfigyelés kikapcsolása</button>
              </> : <>
                <div className="price-search"><IonIcon icon={searchOutline} /><input value={priceQuery} onChange={(event) => setPriceQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchPrices(); } }} placeholder="Termék vagy kategória" /><button type="button" onClick={() => void searchPrices()} disabled={priceBusy || priceQuery.trim().length < 2}>Keresés</button></div>
                <label className="price-target"><span>Opcionális célár</span><input inputMode="decimal" value={targetPrice} onChange={(event) => setTargetPrice(event.target.value)} placeholder="pl. 5999" /></label>
                <div className="price-results">{priceResults.map((result) => <button type="button" className="wide-result" key={result.productId} onClick={() => void savePriceWatch(result.productId)} disabled={priceBusy}><div><strong>{result.productName}</strong><span>{result.sources.join(" · ")} · {result.categoryName}{result.cached ? " · gyorsítótár" : ""}</span><SearchOfferList offers={result.offers} /></div></button>)}</div>
                {priceBusy && <div className="price-loading"><span className="loading-orb" />Árak keresése…</div>}
                {!priceBusy && <button type="button" className="manual-watch-button" onClick={() => void createManualPriceWatch()}><IonIcon icon={pricetagOutline} /> Saját árfigyelés ehhez a tételhez</button>}
              </>}
            </section>
          </div>
        )}

        {accountOpen && actor && (
          <div className="sheet-backdrop account-backdrop" role="presentation" onMouseDown={() => setAccountOpen(false)}>
            <FamilySettings
              actor={actor}
              initialMembers={familyMembers}
              onMembersChanged={setFamilyMembers}
              onClose={() => setAccountOpen(false)}
              onLogout={logout}
            />
          </div>
        )}

        {toast && <div className="toast" role="status"><IonIcon icon={checkmarkCircle} />{toast}</div>}
      </div>
    </IonApp>
  );
}

function AuthView({ mode, error, onSuccess }: { mode: AuthMode; error: string; onSuccess: (actor: Actor) => Promise<void> }) {
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || mode === "checking") return;
    if (mode === "setup" && password !== confirmPassword) {
      setFormError("A két jelszó nem egyezik.");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      const result = await apiRequest<{ actor: Actor }>("POST", {
        username,
        password,
        ...(mode === "setup" ? { displayName } : {}),
      }, mode === "setup" ? "/api/auth/setup" : "/api/auth/login");
      await onSuccess(result.actor);
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : "A belépés nem sikerült.");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "checking") {
    return <div className="auth-screen"><span className="loading-orb" /><h1>Otthon</h1><p>A családi fiók ellenőrzése…</p></div>;
  }

  return (
    <div className="auth-screen">
      <div className="auth-mark"><IonIcon icon={homeOutline} /></div>
      <span className="eyebrow">Csak a családnak</span>
      <h1>{mode === "setup" ? "Költözzetek be" : "Üdv újra itthon"}</h1>
      <p>{mode === "setup" ? "Hozd létre az első, tulajdonosi fiókot. A többi családtagot később innen hívhatod meg." : "Lépj be a családi irányítópultra."}</p>
      <form className="auth-form" onSubmit={submit}>
        {mode === "setup" && <label><span>Megjelenő név</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" placeholder="pl. Olivér" required /></label>}
        <label><span>Felhasználónév</span><input value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} autoCapitalize="none" autoComplete="username" placeholder="pl. oliver" required /></label>
        <label><span>Jelszó</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "setup" ? "new-password" : "current-password"} placeholder="Legalább 10 karakter" minLength={10} required /></label>
        {mode === "setup" && <label><span>Jelszó még egyszer</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={10} required /></label>}
        {(formError || error) && <div className="auth-error" role="alert">{formError || error}</div>}
        <button type="submit" className="primary-button" disabled={busy}>{busy ? "Egy pillanat…" : mode === "setup" ? "Családi fiók létrehozása" : "Belépés"}</button>
      </form>
    </div>
  );
}

type FamilyUser = Pick<Actor, "id" | "username" | "displayName" | "role">;

function FamilySettings({
  actor, initialMembers, onMembersChanged, onClose, onLogout,
}: {
  actor: Actor;
  initialMembers: FamilyMember[];
  onMembersChanged: (members: FamilyMember[]) => void;
  onClose: () => void;
  onLogout: () => Promise<void>;
}) {
  const [users, setUsers] = useState<FamilyUser[]>([]);
  const [members, setMembers] = useState(initialMembers);
  const [adultName, setAdultName] = useState("");
  const [adultUsername, setAdultUsername] = useState("");
  const [adultPassword, setAdultPassword] = useState("");
  const [childName, setChildName] = useState("");
  const [childTone, setChildTone] = useState<Tone>("blue");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadFamily = useCallback(async () => {
    try {
      const result = await apiRequest<{ users: FamilyUser[]; members: FamilyMember[] }>("GET", undefined, "/api/family");
      setUsers(result.users);
      setMembers(result.members);
      onMembersChanged(result.members);
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "Nem sikerült betölteni a családot.");
    }
  }, [onMembersChanged]);

  useEffect(() => {
    let active = true;
    void apiRequest<{ users: FamilyUser[]; members: FamilyMember[] }>("GET", undefined, "/api/family")
      .then((result) => {
        if (!active) return;
        setUsers(result.users);
        setMembers(result.members);
        onMembersChanged(result.members);
      })
      .catch((failure) => {
        if (active) setMessage(failure instanceof Error ? failure.message : "Nem sikerült betölteni a családot.");
      });
    return () => { active = false; };
  }, [onMembersChanged]);

  async function addAdult(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await apiRequest("POST", { action: "addUser", displayName: adultName, username: adultUsername, password: adultPassword }, "/api/family");
      setAdultName("");
      setAdultUsername("");
      setAdultPassword("");
      setMessage("A családtag belépése elkészült.");
      await loadFamily();
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "Nem sikerült hozzáadni.");
    } finally {
      setBusy(false);
    }
  }

  async function addChild(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await apiRequest<{ member: FamilyMember }>("POST", { action: "addMember", name: childName, tone: childTone }, "/api/family");
      const next = [...members, result.member];
      setMembers(next);
      onMembersChanged(next);
      setChildName("");
      setMessage("A gyerek profilja elkészült.");
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "Nem sikerült hozzáadni.");
    } finally {
      setBusy(false);
    }
  }

  async function updateMemberTone(member: FamilyMember, tone: Tone) {
    if (busy || member.tone === tone) return;
    const previous = members;
    const next = members.map((item) => item.id === member.id ? { ...item, tone } : item);
    setMembers(next);
    onMembersChanged(next);
    setBusy(true);
    setMessage("");
    try {
      await apiRequest("PATCH", { action: "updateMemberTone", id: member.id, tone }, "/api/family");
      setMessage(`${member.name} színe módosítva.`);
    } catch (failure) {
      setMembers(previous);
      onMembersChanged(previous);
      setMessage(failure instanceof Error ? failure.message : "Nem sikerült módosítani a színt.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-sheet family-settings" role="dialog" aria-modal="true" aria-labelledby="account-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="account-head">
        <span className="account-large">{displayFirstName(actor).slice(0, 1).toUpperCase()}</span>
        <div><span className="eyebrow">Bejelentkezve</span><h2 id="account-title">{actor.displayName}</h2><p>@{actor.username} · {actor.role === "owner" ? "Tulajdonos" : "Családtag"}</p></div>
        <button type="button" className="icon-button subtle" onClick={onClose} aria-label="Bezárás"><IonIcon icon={close} /></button>
      </div>

      <div className="family-chip-list">
        {members.map((member) => <span className={`family-chip ${member.tone}`} key={member.id}><i />{member.name}</span>)}
      </div>

      {actor.role === "owner" && <div className="family-setting-forms">
        <div className="member-color-panel">
          <h3>Profilok színei</h3>
          <p>A már felvett események színe is automatikusan frissül.</p>
          <div className="member-color-list">
            {members.map((member) => <label key={member.id}><span><i className={`dot ${member.tone}`} />{member.name}</span><select value={member.tone} disabled={busy} onChange={(event) => void updateMemberTone(member, event.target.value as Tone)}>{toneOptions.map((tone) => <option value={tone.value} key={tone.value}>{tone.label}</option>)}</select></label>)}
          </div>
        </div>
        <form onSubmit={addAdult}>
          <h3>Felnőtt belépés hozzáadása</h3>
          <p>Így a párod ChatGPT-fiók nélkül is használhatja.</p>
          <div className="settings-grid">
            <input value={adultName} onChange={(event) => setAdultName(event.target.value)} placeholder="Megjelenő név" required />
            <input value={adultUsername} onChange={(event) => setAdultUsername(event.target.value.toLowerCase())} placeholder="Felhasználónév" autoCapitalize="none" required />
            <input className="wide" type="password" value={adultPassword} onChange={(event) => setAdultPassword(event.target.value)} placeholder="Ideiglenes jelszó · min. 10 karakter" minLength={10} required />
          </div>
          <button type="submit" disabled={busy}>Belépés létrehozása</button>
        </form>
        <form onSubmit={addChild}>
          <h3>Gyerek profil hozzáadása</h3>
          <p>A naptárban ehhez a névhez mindig ugyanaz a szín tartozik.</p>
          <div className="settings-grid child-grid">
            <input value={childName} onChange={(event) => setChildName(event.target.value)} placeholder="Gyerek neve" required />
            <select value={childTone} onChange={(event) => setChildTone(event.target.value as Tone)} aria-label="Profil színe">
              {toneOptions.map((tone) => <option value={tone.value} key={tone.value}>{tone.label}</option>)}
            </select>
          </div>
          <button type="submit" disabled={busy}>Profil hozzáadása</button>
        </form>
      </div>}

      {users.length > 0 && <p className="family-login-count">{users.length} felnőtt belépés · {members.filter((member) => member.memberType === "child").length} gyerekprofil</p>}
      {message && <div className="settings-message" role="status">{message}</div>}
      <button type="button" className="logout-button" onClick={() => void onLogout()}>Kijelentkezés</button>
    </section>
  );
}

function ScreenHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return <header className="screen-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div>{action}</header>;
}

function TodayView({
  actor, events, chores, shopping, remainingChores, remainingShopping, syncing, notificationsEnabled,
  onTab, onToggleChore, onEnableNotifications, onAccount, onAddEvent, onEditEvent,
}: {
  actor: Actor | null; events: FamilyEvent[]; chores: Chore[]; shopping: ShoppingItem[];
  remainingChores: number; remainingShopping: number; syncing: boolean; notificationsEnabled: boolean;
  onTab: (tab: Tab) => void; onToggleChore: (id: number) => void; onEnableNotifications: () => Promise<void>; onAccount: () => void; onAddEvent: () => void; onEditEvent: (event: FamilyEvent) => void;
}) {
  const nowKey = `${localIsoDate()}${new Date().toTimeString().slice(0, 5)}`;
  const nextEvent = events.find((item) => `${item.date}${item.startTime}` >= nowKey);
  const upcomingCount = events.filter((item) => item.date >= localIsoDate()).length;
  return (
    <div className="screen today-screen">
      <ScreenHeader
        eyebrow={longDate()} title={`Szia, ${displayFirstName(actor)}!`}
        action={<div className="header-actions"><button type="button" className={`icon-button notification-button ${notificationsEnabled ? "enabled" : ""}`} onClick={() => void onEnableNotifications()} aria-label={notificationsEnabled ? "Értesítések bekapcsolva" : "Értesítések bekapcsolása"}><IonIcon icon={notificationsOutline} />{!notificationsEnabled && <span />}</button><button type="button" className="account-button" onClick={onAccount} aria-label="Bejelentkezett felhasználó"><span>{displayFirstName(actor).slice(0, 1).toUpperCase()}</span><i className={syncing ? "syncing" : ""} /></button></div>}
      />

      {nextEvent ? <section className="next-event-card">
        <div className="next-event-topline"><span><IonIcon icon={sparklesOutline} /> Következő fontos</span><span>{eventDayLabel(nextEvent.date)} <button type="button" className="next-event-edit" onClick={() => onEditEvent(nextEvent)} aria-label={`${nextEvent.title} szerkesztése`}><IonIcon icon={createOutline} /></button></span></div>
        <div className="next-event-main">
          <div className="time-orb"><strong>{nextEvent.startTime}</strong><span>időpont</span></div>
          <div className="next-event-copy"><span className="person-chip">{nextEvent.person}</span><h2>{nextEvent.title}</h2><p><IonIcon icon={locationOutline} /> {nextEvent.place}</p></div>
        </div>
        <div className="departure-strip">
          <div><IonIcon icon={carOutline} /><span>Indulás<strong>{nextEvent.departureTime || "nincs megadva"}</strong></span></div>
          <div className="driver-avatars"><span className="avatar avatar-olive">{nextEvent.driver.slice(0, 1)}</span><span>Viszi:<strong>{nextEvent.driver}</strong></span></div>
        </div>
      </section> : <button type="button" className="next-event-card empty-next" onClick={onAddEvent}>
        <IonIcon icon={calendarClearOutline} /><span><strong>Még nincs közelgő időpont</strong><small>Koppints ide az első esemény felvételéhez.</small></span><IonIcon icon={chevronForward} />
      </button>}

      <section className="glance-grid" aria-label="Mai összefoglaló">
        <button type="button" className="glance-card violet" onClick={() => onTab("calendar")}><IonIcon icon={calendarClearOutline} /><strong>{upcomingCount}</strong><span>közelgő program</span></button>
        <button type="button" className="glance-card coral" onClick={() => onTab("chores")}><IonIcon icon={checkmarkDoneCircleOutline} /><strong>{remainingChores}</strong><span>mai teendő</span></button>
        <button type="button" className="glance-card mint" onClick={() => onTab("shopping")}><IonIcon icon={bagHandleOutline} /><strong>{remainingShopping}</strong><span>megvásárolandó</span></button>
      </section>

      <SectionTitle title="Mai házimunka" meta={`${chores.length - remainingChores}/${chores.length} kész`} onClick={() => onTab("chores")} />
      {chores.length ? <section className="compact-list">
        {chores.slice(0, 3).map((chore) => <button type="button" className={chore.done ? "compact-task done" : "compact-task"} key={chore.id} onClick={() => onToggleChore(chore.id)}>
          <span className={`task-check ${chore.done ? "checked" : ""}`}><IonIcon icon={checkmark} /></span>
          <span className="task-copy"><strong>{chore.title}</strong><small>{chore.assignee} · {chore.dueLabel}</small></span>
          {chore.recurring && <IonIcon className="repeat-icon" icon={repeatOutline} />}
        </button>)}
      </section> : <EmptyMini text="Még nincs kiosztott házimunka." />}

      <SectionTitle title="Bevásárlás" meta={`${remainingShopping} tétel vár`} onClick={() => onTab("shopping")} />
      {shopping.length ? <button type="button" className="shopping-preview" onClick={() => onTab("shopping")}>
        <div className="shopping-avatars">{shopping.filter((item) => !item.checked).slice(0, 4).map((item, index) => <span key={item.id} style={{ zIndex: 5 - index }}>{item.name.slice(0, 1)}</span>)}</div>
        <div><strong>{shopping.filter((item) => !item.checked).slice(0, 3).map((item) => item.name).join(", ") || "Minden megvan"}</strong><small>{remainingShopping ? `és még ${Math.max(0, remainingShopping - 3)} tétel` : "A lista kész"}</small></div>
        <IonIcon icon={chevronForward} />
      </button> : <EmptyMini text="A bevásárlólista még üres." />}
      <p className="demo-note"><IonIcon icon={cloudDoneOutline} /> Közös, automatikusan szinkronizált adatok</p>
    </div>
  );
}

function EmptyMini({ text }: { text: string }) {
  return <div className="empty-mini">{text}</div>;
}

function SectionTitle({ title, meta, onClick }: { title: string; meta: string; onClick: () => void }) {
  return <div className="section-title"><div><h2>{title}</h2><span>{meta}</span></div><button type="button" onClick={onClick}>Mind <IonIcon icon={chevronForward} /></button></div>;
}

function CalendarView({ events, onEdit, onDelete }: { events: FamilyEvent[]; onEdit: (event: FamilyEvent) => void; onDelete: (id: number, title: string) => void }) {
  const [selectedDate, setSelectedDate] = useState(localIsoDate());
  const [anchorDate, setAnchorDate] = useState(localIsoDate());
  const dates = weekDates(anchorDate);
  const visibleEvents = events.filter((event) => event.date === selectedDate);
  const labels = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];

  function moveWeek(days: number) {
    const next = addDays(anchorDate, days);
    setAnchorDate(next);
    setSelectedDate(weekDates(next)[0]);
  }

  return (
    <div className="screen">
      <ScreenHeader eyebrow={monthYear(selectedDate)} title="Családi naptár" action={<div className="calendar-nav"><button type="button" onClick={() => moveWeek(-7)} aria-label="Előző hét"><IonIcon icon={chevronBack} /></button><button type="button" onClick={() => moveWeek(7)} aria-label="Következő hét"><IonIcon icon={chevronForward} /></button></div>} />
      <section className="week-strip" aria-label="Heti naptár">
        {dates.map((date, index) => <button type="button" key={date} className={selectedDate === date ? "selected" : ""} onClick={() => setSelectedDate(date)}><span>{labels[index]}</span><strong>{dateFromIso(date).getDate()}</strong>{events.some((event) => event.date === date) && <i />}</button>)}
      </section>
      <div className="calendar-summary"><span>{new Intl.DateTimeFormat("hu-HU", { month: "long", day: "numeric" }).format(dateFromIso(selectedDate))}</span><strong>{visibleEvents.length ? `${visibleEvents.length} esemény` : "Nincs program"}</strong></div>
      <section className="event-list">
        {visibleEvents.map((event) => <article className={`event-card ${event.tone}`} key={`${event.id}-${event.date}`}>
          <div className="event-time"><strong>{event.startTime}</strong>{event.departureTime && <small>indulás {event.departureTime}</small>}</div>
          <div className="event-symbol"><EventIcon kind={event.kind} /></div>
          <div className="event-copy"><span>{event.person}{event.repeatRule !== "none" ? " · ismétlődik" : ""}</span><h2>{event.title}</h2><p>{event.place} · {event.driver}</p></div>
          <div className="event-actions"><button type="button" className="edit-item" onClick={() => onEdit(event)} aria-label={`${event.title} szerkesztése`}><IonIcon icon={createOutline} /></button><button type="button" className="delete-item" onClick={() => onDelete(event.id, event.title)} aria-label={`${event.title} törlése`}><IonIcon icon={trashOutline} /></button></div>
        </article>)}
        {!visibleEvents.length && <div className="empty-state"><IonIcon icon={calendarClearOutline} /><h2>Szabad nap</h2><p>Erre a napra még nincs családi program.</p></div>}
      </section>
      {events.length > 0 && <section className="family-legend">{Array.from(new Map(events.map((event) => [event.person, event.tone])).entries()).map(([person, tone]) => <span key={person}><i className={`dot ${tone}`} />{person}</span>)}</section>}
    </div>
  );
}

function ChoresView({ actor, familyMembers, chores, progress, onToggle, onClaim, onEdit, onDelete }: { actor: Actor | null; familyMembers: FamilyMember[]; chores: Chore[]; progress: number; onToggle: (id: number) => void; onClaim: (id: number) => void; onEdit: (chore: Chore) => void; onDelete: (id: number, title: string) => void }) {
  const activeChores = chores.filter((chore) => !chore.done);
  const workloadByPerson = new Map<string, { name: string; tone: Tone; count: number }>();

  familyMembers.forEach((member) => {
    workloadByPerson.set(folded(member.name), { name: member.name, tone: member.tone, count: 0 });
  });
  activeChores.forEach((chore) => {
    const name = chore.assignee.trim() || "Közös";
    const key = folded(name);
    const existing = workloadByPerson.get(key);
    if (existing) existing.count += 1;
    else workloadByPerson.set(key, { name, tone: "violet", count: 1 });
  });

  const workload = Array.from(workloadByPerson.values()).map((person) => ({
    ...person,
    percentage: activeChores.length ? Math.round((person.count / activeChores.length) * 100) : 0,
  }));

  return (
    <div className="screen">
      <ScreenHeader eyebrow="Közös teendők" title="Házimunka" />
      <section className="progress-card">
        <div className="progress-ring" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}><span><strong>{progress}%</strong><small>kész</small></span></div>
        <div><span className="eyebrow">Mai haladás</span><h2>{chores.length ? "Egészen jól álltok!" : "Kezdhetjük tiszta lappal"}</h2><p>{chores.length ? `Még ${chores.filter((item) => !item.done).length} dolog van hátra a nyugodt estéhez.` : "A + gombbal vehettek fel új feladatot."}</p></div>
      </section>
      <section className="workload-card" aria-labelledby="workload-title">
        <div className="workload-heading">
          <div><span className="eyebrow">Felhasználói terheltség</span><h2 id="workload-title">Ki mennyit vállal?</h2></div>
          <strong>{activeChores.length} nyitott</strong>
        </div>
        {workload.length ? <div className="workload-list">
          {workload.map((person) => <div className="workload-row" key={folded(person.name)}>
            <div className="workload-label"><span><i className={`dot ${person.tone}`} />{person.name}</span><strong>{person.count} feladat · {person.percentage}%</strong></div>
            <div className="workload-track" aria-label={`${person.name}: ${person.percentage}%`}><i className={person.tone} style={{ width: `${person.percentage}%` }} /></div>
          </div>)}
        </div> : <p className="workload-empty">A családtagok felvétele után itt látszik majd az eloszlás.</p>}
      </section>
      <div className="rotation-banner"><IonIcon icon={repeatOutline} /><div><strong>Automatikus ismétlődés</strong><span>A napi, heti és havi feladatok a megfelelő időben újranyílnak.</span></div><IonIcon icon={cloudDoneOutline} /></div>
      <section className="chore-list">
        {chores.map((chore) => <article className={chore.done ? "chore-card done" : "chore-card"} key={chore.id}>
          <button type="button" className="chore-toggle" onClick={() => onToggle(chore.id)}>
            <span className={`room-marker ${chore.tone}`}>{chore.room.slice(0, 1)}</span>
            <span className="chore-copy"><strong>{chore.title}</strong><small>{chore.room} · {chore.dueLabel}</small><span className="assignee-pill">{chore.assignee}{chore.repeatRule === "daily" ? " · naponta" : chore.repeatRule === "weekly" ? " · hetente" : chore.repeatRule === "monthly" ? " · havonta" : ""}</span></span>
            <span className={`big-check ${chore.done ? "checked" : ""}`}><IonIcon icon={checkmark} /></span>
          </button>
          <div className="item-actions"><button type="button" className="edit-item" onClick={() => onEdit(chore)} aria-label={`${chore.title} szerkesztése`}><IonIcon icon={createOutline} /></button><button type="button" className="delete-item" onClick={() => onDelete(chore.id, chore.title)} aria-label={`${chore.title} törlése`}><IonIcon icon={trashOutline} /></button></div>
          {!chore.done && actor && folded(chore.assignee) !== folded(actor.displayName) && <button type="button" className="claim-button" onClick={() => onClaim(chore.id)}><strong>Átvállalom</strong><span>{chore.assignee} helyett</span></button>}
        </article>)}
        {!chores.length && <div className="empty-state"><IonIcon icon={checkmarkDoneCircleOutline} /><h2>Nincs elmaradás</h2><p>A + gombbal vehettek fel új házimunkát.</p></div>}
      </section>
    </div>
  );
}

function ShoppingView({ groups, remaining, onToggle, onEdit, onPrice, onDelete, onClear, onQuickAdd, onScan }: { groups: Record<string, ShoppingItem[]>; remaining: number; onToggle: (id: number) => void; onEdit: (item: ShoppingItem) => void; onPrice: (item: ShoppingItem) => void; onDelete: (id: number, title: string) => void; onClear: () => void; onQuickAdd: () => void; onScan: () => void }) {
  const allItems = Object.values(groups).flat();
  return (
    <div className="screen">
      <ScreenHeader eyebrow="Közös lista" title="Bevásárlás" action={<span className="count-badge">{remaining}</span>} />
      <div className="shopping-add-grid">
        <button type="button" className="quick-add-bar" onClick={onQuickAdd}><span><IonIcon icon={add} /></span><div><strong>Mi fogyott el?</strong><small>Gyors hozzáadás</small></div></button>
        <button type="button" className="quick-add-bar barcode-add" onClick={onScan}><span><IonIcon icon={barcodeOutline} /></span><div><strong>Vonalkód</strong><small>Beolvasom</small></div></button>
      </div>
      <div className="shopping-status"><span>{remaining} tétel vár</span><span><IonIcon icon={cloudDoneOutline} /> Azonnal frissül mindenkinél</span></div>
      <section className="shopping-groups">
        {Object.entries(groups).map(([category, items]) => <div className="shopping-group" key={category}>
          <h2>{category}<span>{items.filter((item) => !item.checked).length}</span></h2>
          {items.map((item) => <div className={item.checked ? "shopping-row checked" : "shopping-row"} key={item.id}>
            <button type="button" className="shopping-toggle" onClick={() => onToggle(item.id)}><span className="shop-check"><IonIcon icon={checkmark} /></span><span className="shopping-name"><strong>{item.name}</strong>{item.priceWatch?.bestPrice && <small><IonIcon icon={pricetagOutline} /> {item.priceWatch.source === "gvh" ? "max. " : ""}{formatForint(item.priceWatch.bestPrice)} · {item.priceWatch.bestChain}</small>}</span><span>{item.quantity}</span></button>
            <div className="item-actions"><button type="button" className={item.priceWatch ? "price-item active" : "price-item"} onClick={() => onPrice(item)} aria-label={`${item.name} árfigyelése`}><IonIcon icon={pricetagOutline} /></button><button type="button" className="edit-item" onClick={() => onEdit(item)} aria-label={`${item.name} szerkesztése`}><IonIcon icon={createOutline} /></button><button type="button" className="delete-item" onClick={() => onDelete(item.id, item.name)} aria-label={`${item.name} törlése`}><IonIcon icon={trashOutline} /></button></div>
          </div>)}
        </div>)}
      </section>
      {!allItems.length && <div className="empty-state"><IonIcon icon={cartOutline} /><h2>A lista üres</h2><p>A + gombbal vagy a fenti sávval adjatok hozzá valamit.</p></div>}
      {allItems.some((item) => item.checked) && <button type="button" className="clear-button" onClick={onClear}>Megvásároltak törlése</button>}
    </div>
  );
}

function BarcodeScanner({ onDetected, onError }: { onDetected: (code: string) => void; onError: (message: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let active = true;
    let controls: { stop: () => void } | undefined;
    const video = videoRef.current;

    void (async () => {
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat }] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        if (!active || !video) return;
        const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 120 });
        reader.possibleFormats = [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E];
        controls = await reader.decodeFromConstraints({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        }, video, (result) => {
          if (!active || !result) return;
          active = false;
          controls?.stop();
          if (navigator.vibrate) navigator.vibrate(80);
          onDetected(result.getText());
        });
      } catch (failure) {
        if (!active) return;
        const name = failure instanceof DOMException ? failure.name : "";
        if (name === "NotAllowedError") onError("Engedélyezd a kamerát az Otthon számára az iPhone beállításaiban.");
        else if (name === "NotFoundError") onError("Nem található használható kamera ezen az eszközön.");
        else onError("A kamera nem indult el. Zárd be az ablakot, majd próbáld újra.");
      }
    })();

    return () => {
      active = false;
      controls?.stop();
      const stream = video?.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, [onDetected, onError]);

  return <div className="scanner-camera"><video ref={videoRef} autoPlay muted playsInline aria-label="Vonalkódolvasó kamera" /><div className="scanner-frame"><i /></div><span>Keresem a vonalkódot…</span></div>;
}
