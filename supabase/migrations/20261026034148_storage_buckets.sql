-- Both buckets are private and have no storage policies, so only the service role can read or
-- write them. Browsers upload through a signed upload URL that a Server Action creates for one
-- object key, and see images only through short-lived signed URLs: the unblanked crop and the
-- source slide are signed only after the student's attempt is stored (build plan, D-3).
--
-- Object keys (web/lib/contracts.ts and contracts/examples.json):
--   uploads/{user_id}/{document_id}.pptx
--   renders/{user_id}/{document_id}/pages/{page:03}.png        page renders, 1-based
--   renders/{user_id}/{document_id}/assets/{asset_id}.png      unblanked diagram crops
--   renders/{user_id}/{document_id}/questions/{question_id}.png blanked question images

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'uploads', 'uploads', false, 50 * 1024 * 1024,
    array['application/vnd.openxmlformats-officedocument.presentationml.presentation']
  ),
  ('renders', 'renders', false, 10 * 1024 * 1024, array['image/png', 'image/jpeg', 'image/webp']);
