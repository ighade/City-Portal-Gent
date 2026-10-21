#!/bin/sh
# Haalt de Gentse evenementen op bij Social Fetch (1 credit per pagina, maximaal 10 pagina's)
# en schrijft ze in de tabellen Events en EventPlaces. Opnieuw draaien vervangt bestaande rijen
# op id. Vereist: curl, python3, docker compose en Socialfetch__ApiKey in .env.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"

docker=docker
command -v docker >/dev/null 2>&1 || docker=docker.exe

api_key=$(sed -n 's/^Socialfetch__ApiKey=//p' .env | head -n 1 | tr -d '\r"')
db_user=$(sed -n 's/^POSTGRES_USER=//p' .env | head -n 1 | tr -d '\r"')
db_name=$(sed -n 's/^POSTGRES_DB=//p' .env | head -n 1 | tr -d '\r"')
[ -n "$api_key" ] || { echo "Socialfetch__ApiKey ontbreekt in .env" >&2; exit 1; }

url="https://www.facebook.com/events/explore/gent-belgium/102155463159279"
max_pages=10
dir=$(mktemp -d)
tmp="$dir/merged.json"
trap 'rm -rf "$dir"' EXIT

# Volgt data.page.nextCursor tot hasMore false is, met een plafond omdat elke oproep 1 credit kost.
cursor=""
page=0
more=true
while [ "$more" = true ] && [ "$page" -lt "$max_pages" ]; do
  page=$((page + 1))
  if [ -n "$cursor" ]; then
    curl -fsS -G "https://api.socialfetch.dev/v1/facebook/events" \
      --data-urlencode "url=$url" --data-urlencode "cursor=$cursor" -H "x-api-key: $api_key" -o "$dir/page$page.json"
  else
    curl -fsS -G "https://api.socialfetch.dev/v1/facebook/events" \
      --data-urlencode "url=$url" -H "x-api-key: $api_key" -o "$dir/page$page.json"
  fi
  next=$(python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))["data"]
p = d.get("page") or {}
print(("true" if p.get("hasMore") and p.get("nextCursor") else "false") + " " + (p.get("nextCursor") or ""))
print(len(d.get("events") or []), file=sys.stderr)
' "$dir/page$page.json")
  more=${next%% *}
  cursor=${next#* }
  echo "pagina $page opgehaald" >&2
done
[ "$more" = true ] && echo "Let op: plafond van $max_pages pagina's bereikt, er zijn nog meer evenementen." >&2

python3 - "$dir" "$page" > "$tmp" <<'PY'
import json, sys
d, n = sys.argv[1], int(sys.argv[2])
events, seen = [], set()
for i in range(1, n + 1):
    for e in json.load(open(f"{d}/page{i}.json"))["data"].get("events") or []:
        if e["id"] not in seen:
            seen.add(e["id"])
            events.append(e)
print(json.dumps({"data": {"events": events}}))
PY
echo "$page oproep(en), $(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["data"]["events"]))' "$tmp") unieke evenementen" >&2

{
  printf '%s\n' "BEGIN;" "CREATE TEMP TABLE raw_events (doc jsonb) ON COMMIT DROP;" "INSERT INTO raw_events VALUES (\$json\$"
  cat "$tmp"
  printf '\n%s\n' "\$json\$::jsonb);"
  cat <<'SQL'
INSERT INTO "EventPlaces" ("Id", "Name")
SELECT DISTINCT ON (e->'place'->>'id') e->'place'->>'id', COALESCE(e->'place'->>'name', '')
FROM raw_events, jsonb_array_elements(doc->'data'->'events') e
WHERE e->'place'->>'id' IS NOT NULL
ON CONFLICT ("Id") DO UPDATE SET "Name" = EXCLUDED."Name";

INSERT INTO "Events" ("Id", "Url", "Name", "CoverImageUrl", "CoverPhotoId", "CoverAccessibilityCaption",
  "IsOnline", "IsPast", "IsHappeningNow", "StartsAtUtc", "DayTimeLabel", "PlaceId", "Kind", "SocialSummary",
  "InterestedCount", "GoingCount", "WentCount", "TicketPriceLabel", "ImportedAtUtc")
SELECT e->>'id', e->>'url', COALESCE(e->>'name', ''), e->'cover'->>'imageUrl', e->'cover'->>'photoId',
  e->'cover'->>'accessibilityCaption',
  COALESCE((e->>'isOnline')::boolean, false), COALESCE((e->>'isPast')::boolean, false),
  COALESCE((e->>'isHappeningNow')::boolean, false), (e->>'startsAt')::timestamptz, e->>'dayTimeLabel',
  e->'place'->>'id', e->>'kind', e->'social'->>'summary',
  (e->'social'->>'interestedCount')::int, (e->'social'->>'goingCount')::int, (e->'social'->>'wentCount')::int,
  e->>'ticketPriceLabel', now()
FROM raw_events, jsonb_array_elements(doc->'data'->'events') e
ON CONFLICT ("Id") DO UPDATE SET
  "Url" = EXCLUDED."Url", "Name" = EXCLUDED."Name", "CoverImageUrl" = EXCLUDED."CoverImageUrl",
  "CoverPhotoId" = EXCLUDED."CoverPhotoId", "CoverAccessibilityCaption" = EXCLUDED."CoverAccessibilityCaption",
  "IsOnline" = EXCLUDED."IsOnline", "IsPast" = EXCLUDED."IsPast", "IsHappeningNow" = EXCLUDED."IsHappeningNow",
  "StartsAtUtc" = EXCLUDED."StartsAtUtc", "DayTimeLabel" = EXCLUDED."DayTimeLabel", "PlaceId" = EXCLUDED."PlaceId",
  "Kind" = EXCLUDED."Kind", "SocialSummary" = EXCLUDED."SocialSummary",
  "InterestedCount" = EXCLUDED."InterestedCount", "GoingCount" = EXCLUDED."GoingCount",
  "WentCount" = EXCLUDED."WentCount", "TicketPriceLabel" = EXCLUDED."TicketPriceLabel",
  "ImportedAtUtc" = EXCLUDED."ImportedAtUtc";
COMMIT;
SELECT count(*) AS events FROM "Events";
SQL
} | "$docker" compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name"
