# Otthon

Saját családi használatra készült, iPhone-ra optimalizált PWA. Egy helyen kezeli a családi eseményeket, az ismétlődő házimunkát és a közös bevásárlólistát.

## Mit tud?

- közös naptár személyenkénti színekkel és ismétlődő eseményekkel;
- indulási idő, sofőr, helyszín és orvosi/iskolai eseménytípus;
- ismétlődő házimunkák és közös bevásárlólista, családi aktivitásértesítésekkel;
- vonalkódos termékfelismerés és többforrású árfigyelés (GVH, Tesco, Lidl, saját árak);
- céláras értesítés, Clubcard-/akciós érvényesség és napi ártörténet;
- gyors, szöveges bevitel magyar dátum- és időfelismeréssel;
- saját családi belépés, ChatGPT-fiók nélkül;
- tulajdonosi és külön felnőtt-fiókok, gyerekprofilok;
- telepíthető iPhone PWA és esemény-emlékeztető push értesítések.

## Helyi indítás

Szükséges: Node.js 22 vagy 24 és PostgreSQL.

```bash
npm ci
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Az első megnyitáskor az alkalmazás kéri a tulajdonosi felhasználónevet és jelszót. A jelszavak scrypt hashként kerülnek az adatbázisba, a belépési cookie HTTP-only.

## Railway telepítés

1. Hozz létre egy Railway projektet a privát GitHub repóból.
2. Adj a projekthez PostgreSQL szolgáltatást. A `DATABASE_URL` automatikusan elérhetővé tehető az app szolgáltatásban.
3. Az app szolgáltatás a gyökérben lévő `railway.json` fájlt használja. A build után, indulás előtt automatikusan lefut az adatbázis-migráció.
4. Generálj VAPID kulcsokat az `npm run vapid:generate` paranccsal, majd add hozzá a Railway változókhoz a `.env.example` alapján.
5. Az értesítésekhez hozz létre ugyanebből a repóból egy második Railway szolgáltatást. A Config File Path legyen `/railway.cron.json`, a cron ütemezés pedig `*/5 * * * *` (UTC).

A cron szolgáltatás ugyanazokat a `DATABASE_URL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` és `VAPID_SUBJECT` változókat kapja. Az alkalmazás egy eseményhez csak egyszer küld értesítést akkor is, ha a cron újra lefut. A GVH katalógus és a Tesco/Lidl figyelések naponta egyszer frissülnek; a Tesco publikus frontend-konfigurációját a rendszer automatikusan olvassa ki. A vonalkód–termék megfeleltetés tartósan megmarad, a külső árkeresés eredménye három napig újra felhasználható. A `TESCO_API_KEY` csak opcionális tartalék, normál esetben üresen maradhat. Az Aldi és a helyi boltok blokkára az árfigyelőn belül saját árként rögzíthető.

## Ellenőrzés

```bash
npm test
npm run lint
npm run build
```

Az egész család adatai ugyanabban a privát PostgreSQL-adatbázisban maradnak. Nyilvános regisztráció nincs: az első tulajdonos hozhat létre további felnőtt-belépéseket és gyerekprofilokat.
