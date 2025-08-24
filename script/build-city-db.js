import fs from "fs";
import { parse } from "csv-parse/sync";

// ---------- Helpers ----------
function normalizeName(name) {
  if (!name) return "";
  // Normalize unicode -> strip diacritics -> lowercase -> alphanum+space only
  const nfkd = name.normalize("NFKD");
  const ascii = nfkd.replace(/[\u0300-\u036f]/g, ""); // strip accents
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

// ---------- 1. Load GeoNames cities500 ----------
const citiesRaw = fs.readFileSync("cities500.txt", "utf-8");
const citiesCols = [
  "geonameid","name","asciiname","alternatenames","lat","lon","fclass","fcode",
  "country_code","cc2","admin1","admin2","admin3","admin4",
  "population","elevation","dem","tz","moddate"
];

const cities = parse(citiesRaw, {
  delimiter: "\t",
  relaxQuotes: true,
  skip_empty_lines: true
}).map(row => {
  const obj = {};
  citiesCols.forEach((c,i) => { obj[c] = row[i]; });
  return obj;
});

// ---------- 2. Load country info ----------
const countryRaw = fs.readFileSync("countryInfo.txt", "utf-8");
const countries = {};
countryRaw.split("\n").forEach(line => {
  if (!line || line.startsWith("#")) return;
  const parts = line.split("\t");
  countries[parts[0]] = parts[4]; // code → country name
});

// ---------- 3. Filter + transform ----------
const result = cities
  .filter(c => Number(c.population) > 8000)
  .map(c => {
    const norm = normalizeName(c.name);
    return {
      name: c.name,
      country: countries[c.country_code] || c.country_code,
      center: { lat: Number(c.lat), lng: Number(c.lon) },
      name_norm_clean: norm,
      prefix2: norm.slice(0,2),
      prefix3: norm.slice(0,3)
    };
  });

// ---------- 4. Write output ----------
fs.writeFileSync(
  "cities_200k.json",
  JSON.stringify(result, null, 2),
  "utf-8"
);

console.log(`Exported ${result.length} cities with population >200k`);
