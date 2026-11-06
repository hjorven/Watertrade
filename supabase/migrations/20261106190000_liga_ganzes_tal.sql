-- Liga: alle Städte des Tals mit ihren typischen Waren.
-- Bestand über dem Ziel heißt billig (Erzeuger), darunter teuer (Abnehmer).
-- Bestehende Zeilen bleiben unverändert.
insert into public.league_market (town_id, good_id, base_price, stock, target_stock, rest_stock) values
  ('oberau',      'wolle',     15, 200, 100, 200),
  ('oberau',      'bier',      30,  50, 100,  50),
  ('kesselbrueck','getreide',   8, 210, 100, 210),
  ('kesselbrueck','mehl',      16, 180, 100, 180),
  ('kesselbrueck','holz',      10,  60, 100,  60),
  ('kesselbrueck','werkzeug',  60,  45, 100,  45),
  ('muehlheim',   'mehl',      16,  60, 100,  60),
  ('muehlheim',   'bretter',   22, 200, 100, 200),
  ('muehlheim',   'brot',      26, 190, 100, 190),
  ('muehlheim',   'kohle',     12,  55, 100,  55),
  ('altenfurt',   'brot',      26,  50, 100,  50),
  ('altenfurt',   'stoff',     40, 190, 100, 190),
  ('altenfurt',   'glas',      45,  55, 100,  55),
  ('altenfurt',   'moebel',    70,  45, 100,  45),
  ('weidenhof',   'fisch',     14, 220, 100, 220),
  ('weidenhof',   'wolle',     15,  60, 100,  60),
  ('weidenhof',   'bier',      30, 190, 100, 190),
  ('weidenhof',   'getreide',   8, 170, 100, 170),
  ('niedermuend', 'fisch',     14,  50, 100,  50),
  ('niedermuend', 'arznei',    55, 180, 100, 180),
  ('niedermuend', 'moebel',    70,  60, 100,  60),
  ('erzgrube',    'erz',       18, 230, 100, 230),
  ('erzgrube',    'kohle',     12, 200, 100, 200),
  ('erzgrube',    'brot',      26,  45, 100,  45),
  ('erzgrube',    'werkzeug',  60,  60, 100,  60),
  ('glashuette',  'glas',      45, 200, 100, 200),
  ('glashuette',  'werkzeug',  60, 190, 100, 190),
  ('glashuette',  'erz',       18,  50, 100,  50),
  ('glashuette',  'salz',      20,  55, 100,  55)
on conflict (town_id, good_id) do nothing;
