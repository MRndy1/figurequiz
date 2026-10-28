-- What the picture check (route image_check) made of each diagram candidate, so the deck page
-- can say which pictures were skipped and why: "p.6 screenshot, skipped". Null until the check
-- runs. Written by web's generation; assets stay service-only, so no user reads it directly.
alter table public.assets
  add column picture_kind text check (
    picture_kind in ('labelled_diagram', 'screenshot', 'chart', 'photo', 'text', 'decoration', 'plain_figure')
  );
