-- Udozo's colours come from its logo (5 November 2026, the owner's request): a theme still on the old default, BitoCard's
-- navy and pink, moves to Udozo blue (the logo's #185174 with a brighter blue). A theme an admin set by hand, or another
-- ready-made one, is left as it is. A published change is the next version, as publishing would make it.
UPDATE "site_themes"
SET "published" = '{"preset":"udozo_blue","colors":{"primary":"#185174","accent":"#0e7cc0","ink":"#10212e","page":"#ffffff"}}'::jsonb,
    "version" = "version" + 1,
    "published_at" = NOW()
WHERE "published" ->> 'preset' = 'navy_pink';

UPDATE "site_themes"
SET "draft" = '{"preset":"udozo_blue","colors":{"primary":"#185174","accent":"#0e7cc0","ink":"#10212e","page":"#ffffff"}}'::jsonb
WHERE "draft" ->> 'preset' = 'navy_pink';
