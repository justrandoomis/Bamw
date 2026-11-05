-- The games database: every Nintendo Switch and Switch 2 title in Nintendo
-- Europe's official index (about twenty thousand), browsable at /games-db.
--
-- NOT the catalogue. The shop's products live in store_kv as one JSON document
-- that every visitor downloads through /api/data (about five megabytes), so
-- twenty thousand titles added there would be shipped to every phone that opens
-- the shop. These rows are read a page at a time by /api/games-db, and only by
-- the people who open that section.
--
-- Written only by scripts/games-db-load.mjs, a run-once workflow, with
-- INSERT OR REPLACE keyed on Nintendo Europe's own id. D1 over REST is not one
-- transaction, so a load that stops half way is finished by running it again,
-- and a reader in between sees whole rows, old or new, never a torn one.
--
-- No price is stored here. Prices belong to the shop's products, and a title
-- the shop sells links to that product instead (shop_product_id, checked
-- against product_index when it is read, so a hidden product is never linked).
--
-- The loader runs this same file before it writes, which is why every
-- statement is IF NOT EXISTS and running it twice changes nothing.

CREATE TABLE IF NOT EXISTS nintendo_titles (
  -- Nintendo Europe's fs_id: stable across renames, unlike the title.
  eu_id           TEXT PRIMARY KEY,
  -- The address: the title folded to ASCII, then the id, so it is unique.
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  -- The title folded the way a search is (src/lib/games-db.ts foldTitle).
  norm_title      TEXT NOT NULL DEFAULT '',
  -- switch1, switch2, or both.
  platform        TEXT NOT NULL DEFAULT 'switch1',
  -- YYYY-MM-DD, or empty when Nintendo has not announced one.
  release_date    TEXT NOT NULL DEFAULT '',
  publisher       TEXT NOT NULL DEFAULT '',
  developer       TEXT NOT NULL DEFAULT '',
  -- Nintendo's own one-line pitch, in English.
  description     TEXT NOT NULL DEFAULT '',
  -- JSON arrays of Nintendo's own names, for display. Filtering by genre goes
  -- through nintendo_title_genres below.
  genres          TEXT NOT NULL DEFAULT '[]',
  series          TEXT NOT NULL DEFAULT '[]',
  age_rating      TEXT NOT NULL DEFAULT '',
  players         TEXT NOT NULL DEFAULT '',
  languages       TEXT NOT NULL DEFAULT '',
  size            TEXT NOT NULL DEFAULT '',
  nsuid           TEXT NOT NULL DEFAULT '',
  product_code    TEXT NOT NULL DEFAULT '',
  physical        INTEGER NOT NULL DEFAULT 0,
  digital         INTEGER NOT NULL DEFAULT 0,
  -- Removed from the Nintendo eShop. Kept, and labelled, rather than dropped.
  delisted        INTEGER NOT NULL DEFAULT 0,
  -- Nintendo's three pictures, each in its own role: the vertical front box,
  -- the square card and the wide 2:1 key art.
  image_box       TEXT NOT NULL DEFAULT '',
  image_square    TEXT NOT NULL DEFAULT '',
  image_wide      TEXT NOT NULL DEFAULT '',
  eu_url          TEXT NOT NULL DEFAULT '',
  -- The shop's product for this title, when it sells one. Empty otherwise.
  shop_product_id TEXT NOT NULL DEFAULT '',
  -- A digest of every column above, so a second load rewrites only what changed.
  content_hash    TEXT NOT NULL DEFAULT '',
  loaded_at       TEXT NOT NULL DEFAULT ''
);

-- A-Z order, and a search that starts at the beginning of a name.
CREATE INDEX IF NOT EXISTS idx_nintendo_titles_norm_title ON nintendo_titles (norm_title);
-- The console filter, newest first.
CREATE INDEX IF NOT EXISTS idx_nintendo_titles_platform ON nintendo_titles (platform, release_date DESC);
-- The default order with no filter: newest first.
CREATE INDEX IF NOT EXISTS idx_nintendo_titles_release ON nintendo_titles (release_date DESC);

-- One row per title and genre. A title usually has two or three genres, and a
-- filter on any one of them has to find it, which a JSON column cannot do
-- through an index. The primary key leads with the genre, so it is the index
-- the filter and the genre counts both use.
CREATE TABLE IF NOT EXISTS nintendo_title_genres (
  genre TEXT NOT NULL,
  eu_id TEXT NOT NULL,
  PRIMARY KEY (genre, eu_id)
);

-- A title's own genres, for the loader's tidy-up after a title changes them.
CREATE INDEX IF NOT EXISTS idx_nintendo_title_genres_title ON nintendo_title_genres (eu_id);

-- The rest of what Nintendo's index says about a title, beside its row: the
-- downloads rank (1 = most downloaded, 0 = unranked; about half are ranked),
-- which orders the catalogue by «best sellers», and a JSON object of play
-- modes, local and online players, Nintendo Switch Online, cloud saves and
-- a 16:9 picture (scripts/lib/games-db-rows.mjs detailsJson). A table of its
-- own because CREATE TABLE IF NOT EXISTS can be run before every load and an
-- added column cannot. The title row's digest covers it.
CREATE TABLE IF NOT EXISTS nintendo_title_details (
  eu_id          TEXT PRIMARY KEY,
  downloads_rank INTEGER NOT NULL DEFAULT 0,
  details        TEXT NOT NULL DEFAULT '{}'
);

-- «Best sellers»: the ranked titles in rank order.
CREATE INDEX IF NOT EXISTS idx_nintendo_title_details_rank ON nintendo_title_details (downloads_rank);

-- The loader's stamp: key 'revision', value the time of the load, written
-- after the load's last batch. The API keys its edge cache on it. A load
-- rewrites rows for minutes, and an answer cached in that time — a total of
-- 8,800 of 20,065 on 2026-11-05 — was otherwise served for the cache's full
-- hour after the load. With the stamp, it is never served once the load ends.
-- A database loaded before this table existed has no row, and the key says 0.
CREATE TABLE IF NOT EXISTS nintendo_titles_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
