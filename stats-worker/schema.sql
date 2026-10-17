-- Anonymous TransChat usage. No names, messages, room codes or IP addresses.
-- Times are when the Worker received the report (milliseconds since 1970),
-- so people's clocks don't matter.

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,         -- random ID, not the room code
  started INTEGER,             -- "start" report received (NULL if it was lost)
  ended INTEGER NOT NULL,      -- latest report received for this room
  max_people INTEGER NOT NULL  -- most people anyone saw at once
);

CREATE TABLE IF NOT EXISTS room_langs (
  room TEXT NOT NULL,
  lang TEXT NOT NULL,
  PRIMARY KEY (room, lang)
);

CREATE INDEX IF NOT EXISTS rooms_ended ON rooms (ended);
