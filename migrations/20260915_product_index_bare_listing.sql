-- A listing that is still only a name and a price.
--
-- Fifteen hundred supplier titles were published in that state deliberately:
-- the customer can find the game and order it while the cover, the description
-- and the rest are written up over the following weeks. The admin table needs
-- to tell those apart from the games that have actually been finished, and the
-- count has to be honest across the whole catalogue rather than the fifty rows
-- on screen — which means it is a stored column, aggregated in SQL.
--
-- It replaces `performance_required` as the chip the table offers: that one
-- described a handful of Switch 2 records, this one describes most of the shop.
--
-- Derived at projection time from the same floor `publishGate.ts` refuses to
-- publish below (one usable image, forty characters of description), so a game
-- leaves the filter the moment it is written up, with no flag to remember to
-- clear.
--
-- Existing rows read 0 until the projection is rebuilt. That undercounts
-- rather than overcounts, and `bootstrapProductIndex` fills them in.
ALTER TABLE product_index ADD COLUMN bare_listing INTEGER NOT NULL DEFAULT 0;

-- The chip filters on it and the aggregate sums it; both scan the whole table.
CREATE INDEX IF NOT EXISTS idx_pi_bare_listing ON product_index (bare_listing, sort_updated DESC);
